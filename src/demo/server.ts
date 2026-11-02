/**
 * POST /api/demo/login — the demo session endpoint. LOCAL ONLY for now.
 *
 * Deliberately not a public route: it binds 127.0.0.1, it does not start unless
 * DEMO_LOGIN_ENABLED=1, and it refuses to start at all when NODE_ENV=production. E2b's enforcement
 * is what makes wider exposure defensible; E2a does not expose it.
 *
 * WHAT IT DOES NOT DO: it does not create identities, does not accept a personId, does not read
 * `.demo-credentials`, and cannot sign a token. It asks Supabase Auth for a magic link for one
 * allow-listed email and exchanges the hashed token for that user's real session.
 *
 * RATE LIMITS: per IP and per persona, both in memory (this process is the only caller, and the demo
 * is one laptop). A refusal is 429 with Retry-After; it never becomes a hint about which persona
 * exists.
 *
 * LOGGING: personaId and outcome code only. Never a token, link, OTP or token hash.
 */
import express, { type Request, type Response } from 'express';
import { DEMO_PERSONAS, personaById, type DemoLoginResponse } from './personas';
import { isReady } from './personas';
import { MintError } from './session';
import { getPersonaSession, publicPersonaSession, dropPersonaSessionCache } from './persona-sessions';
import { createDemoFamily, familyPersona, listFamilyPersonas, FamilyError, cleanName } from './family';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { verifyBearer } from '../auth/verify';
import { cooldownRefusal, identityRefusal, isLoopback, NO_STORE } from './guards';
import { InFlightLocks, RESET_IN_FLIGHT, SHARED_RESET_LOCK, windowRefusal } from './guards';
import { resolveClientIp } from './client-ip';
import { routeBetween, allowRoute, RouteUnavailable, isRouteProfile } from '../village/ors';
import { decideRoute, type PlaceLookup } from '../village/routeRequest';
import { dbDayTransport, isDay, readDayPlan } from '../village/dayPlaces';
import { dbFor } from '../db';
import type { Ctx } from '../authz';

/**
 * Orbit photos live in a PRIVATE directory that is never served statically. The only way to a byte is
 * GET /api/orbit/photo/:photoId, which re-checks the caller's CURRENT authority on every request.
 */
/**
 * Drops APPn (EXIF/XMP/IPTC) and COM segments from a JPEG before it is re-encoded. Re-encoding alone
 * is not a guarantee: some encoders copy an APP1 block straight through. This walks the segment
 * markers and keeps only what is needed to decode the image.
 */
function stripJpegMetadata(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return input;
  const parts: Buffer[] = [input.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= input.length) {
    if (input[i] !== 0xff) {
      parts.push(input.subarray(i));
      break;
    }
    const marker = input[i + 1];
    if (marker === 0xda) {            // start of scan: copy the remainder verbatim
      parts.push(input.subarray(i));
      break;
    }
    const len = input.readUInt16BE(i + 2);
    const end = i + 2 + len;
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(input.subarray(i, Math.min(end, input.length)));
    i = end;
  }
  return Buffer.concat(parts);
}

const ORBIT_PHOTO_DIR = process.env.ORBIT_PHOTO_DIR ?? join(process.cwd(), 'var', 'orbit-photos');

function bearerToken(header?: string): string | undefined {
  if (!header) return undefined;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Sliding-window counters. Small, pruned, and only ever used for refusals. */
type Window = { hits: number[]; };
// Per IP: a whole demo session switching personas quickly must not self-limit (11 personas exist).
// Per persona: still protective against minting storms for one identity.
const IP_WINDOW_MS = 60_000;
const IP_LIMIT = 60;
const PERSONA_WINDOW_MS = 60_000;
const PERSONA_LIMIT = 8;

const byIp = new Map<string, Window>();
const byPersona = new Map<string, Window>();

function take(map: Map<string, Window>, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const entry = map.get(key) ?? { hits: [] };
  entry.hits = entry.hits.filter((t) => now - t < windowMs);
  if (entry.hits.length >= limit) {
    map.set(key, entry);
    const oldest = entry.hits[0] ?? now;
    return { allowed: false as const, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
  }
  entry.hits.push(now);
  map.set(key, entry);
  return { allowed: true as const, retryAfterSeconds: 0 };
}

/** Prune so a long-running process does not grow without bound. */
function prune(map: Map<string, Window>, windowMs: number) {
  const now = Date.now();
  for (const [key, entry] of map) {
    entry.hits = entry.hits.filter((t) => now - t < windowMs);
    if (entry.hits.length === 0) map.delete(key);
  }
}

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / curl / the proof script
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function createDemoLoginApp() {
  const app = express();
  // One reset at a time per person: a reset is expensive and destructive.
  const lastResetAt = new Map<string, number>();
  const RESET_COOLDOWN_MS = 30_000;
  // Public-boundary state. NOTE: the loopback guard below is NOT public protection — behind cloudflared
  // every request arrives from 127.0.0.1, so the socket peer proves nothing. These two are what actually
  // bound a public caller: a per-CLIENT-IP window (a persona-keyed limit is useless against a caller who
  // can mint personas) and a one-at-a-time lock per identity (the cooldown does not close the
  // same-millisecond race between two overlapping resets).
  const RESET_IP_WINDOW_MS = 60_000;
  const RESET_IP_MAX = 5;
  const resetIpHits = new Map<string, number[]>();
  const resetLocks = new InFlightLocks();
  const lastFamilyAt = new Map<string, number>();
  const FAMILY_COOLDOWN_MS = 5_000;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2kb' }));

  app.use((req: Request, res: Response, next) => {
    // No caching of anything this route returns.
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (!originAllowed(typeof origin === 'string' ? origin : undefined)) {
      res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
      return;
    }
    if (typeof origin === 'string') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/demo/health', async (_req: Request, res: Response) => {
    // Created families are picker entries too: the registry is the only list of them.
    const families = await listFamilyPersonas();
    res.json({
      ok: true,
      localOnly: true,
      personas: [...DEMO_PERSONAS, ...families].map((p) => ({ personaId: p.id, ready: isReady(p) })),
    });
  });

  app.post('/api/demo/login', async (req: Request, res: Response) => {
    const body = req.body as { personaId?: unknown } | undefined;
    const personaId = typeof body?.personaId === 'string' ? body.personaId : '';

    if (!personaId || personaId.length > 64) {
      res.status(400).json({ error: 'INVALID_REQUEST' });
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const ipGate = take(byIp, ip, IP_LIMIT, IP_WINDOW_MS);
    if (!ipGate.allowed) {
      res.setHeader('Retry-After', String(ipGate.retryAfterSeconds));
      res.status(429).json({ error: 'RATE_LIMITED' });
      return;
    }
    const personaGate = take(byPersona, personaId, PERSONA_LIMIT, PERSONA_WINDOW_MS);
    if (!personaGate.allowed) {
      res.setHeader('Retry-After', String(personaGate.retryAfterSeconds));
      res.status(429).json({ error: 'RATE_LIMITED' });
      return;
    }

    // Allow-list first. An unknown id and a known-but-unseeded persona answer identically.
    // A created family is resolved through the server-side registry (0049), never from client input.
    const persona = personaById(personaId) ?? (await familyPersona(personaId));
    if (!persona) {
      const unavailable: DemoLoginResponse = { status: 'UNAVAILABLE', personaId, reason: 'UNKNOWN_PERSONA' };
      console.log(`[demo-login] ${personaId} -> UNAVAILABLE (unknown)`);
      res.json(unavailable);
      return;
    }
    if (!isReady(persona)) {
      const unavailable: DemoLoginResponse = { status: 'UNAVAILABLE', personaId, reason: 'NO_SEEDED_IDENTITY' };
      console.log(`[demo-login] ${personaId} -> UNAVAILABLE (not seeded)`);
      res.json(unavailable);
      return;
    }

    try {
      // One shared session per persona: cached, single-flight minted, renewed inside the safety
      // window. Only the access token crosses the wire; the refresh token stays in this process.
      const { session } = await getPersonaSession(persona);
      const response: DemoLoginResponse = {
        status: 'READY',
        personaId: persona.id,
        personId: persona.personId,
        persona: {
          id: persona.id,
          personId: persona.personId,
          name: persona.name,
          role: persona.role,
          childId: persona.childId,
          childName: persona.childName,
          villageId: persona.villageId,
          grants: persona.grants,
          parent: persona.parent,
          ...(persona.guardian ? { guardian: true } : {}),
          ...(persona.initialRoute ? { initialRoute: persona.initialRoute } : {}),
        },
        scope: {
          childId: persona.childId,
          childName: persona.childName,
          parentName: persona.name,
          villageId: persona.villageId,
        },
        session: publicPersonaSession(session),
        marks: { demo: true, demoGuide: persona.id === 'demo-guide' },
      };
      console.log(`[demo-login] ${personaId} -> READY`);
      res.json(response);
    } catch (error) {
      // A code only. No error text from Supabase reaches the client or the log.
      const code = error instanceof MintError ? error.code : 'MINT_FAILED';
      console.error(`[demo-login] ${personaId} -> ${code}`);
      res.status(503).json({ status: 'UNAVAILABLE', personaId, reason: code });
    }
  });

  // ---------------------------------------------------------------- Orbit media
  // Cache-Control: no-store on EVERY response, including refusals: a cached copy would outlive the
  // authority check. No signed URL is ever minted or returned.
  app.get('/api/orbit/photo/:photoId', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    const identity = await verifyBearer(req.headers.authorization);
    if (!identity.ok) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    const ctx: Ctx = { today: todayIso(), token };
    try {
      const { data, error } = await dbFor(ctx).rpc('orbit_photo_access', { p_photo: req.params.photoId });
      const row = (Array.isArray(data) ? data[0] : data) as
        | { access?: string | null; storage_path?: string | null }
        | null;
      // No access and no such photo are the SAME answer: 404, no hint either way.
      if (error || !row?.access || !row?.storage_path) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      const file = join(ORBIT_PHOTO_DIR, basename(row.storage_path));
      if (!existsSync(file)) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('X-Orbit-Access', String(row.access));
      res.send(readFileSync(file));
    } catch {
      res.status(404).json({ error: 'NOT_FOUND' });
    }
  });

  // Upload: parent/guardian only. Metadata is stripped by re-encoding BEFORE the bytes are stored;
  // the content hash written to the database is the hash of the stored bytes.
  app.post(
    '/api/orbit/photo',
    express.raw({ type: ['image/jpeg', 'image/png'], limit: '8mb' }),
    async (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      const token = bearerToken(req.headers.authorization);
      const childId = typeof req.query.childId === 'string' ? req.query.childId : '';
      if (!token || !childId) {
        res.status(401).json({ error: 'UNAUTHENTICATED' });
        return;
      }
      const identity = await verifyBearer(req.headers.authorization);
      if (!identity.ok) {
        res.status(401).json({ error: 'UNAUTHENTICATED' });
        return;
      }
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'EMPTY_BODY' });
        return;
      }
      mkdirSync(ORBIT_PHOTO_DIR, { recursive: true });
      const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const rawPath = join(ORBIT_PHOTO_DIR, `.raw-${stamp}`);
      const strippedPath = join(ORBIT_PHOTO_DIR, `orbit-${stamp}.jpg`);
      try {
        writeFileSync(rawPath, stripJpegMetadata(body));
        // Re-encoding drops EXIF/GPS. If the tool is unavailable we REFUSE rather than store
        // unstripped metadata and claim otherwise.
        execFileSync('sips', ['-s', 'format', 'jpeg', rawPath, '--out', strippedPath], { stdio: 'ignore' });
        // sips writes its own APP1 block on output, so the segment strip runs on BOTH sides of the
        // re-encode. Re-encoding alone is not a guarantee; the byte strip is.
        const cleaned = stripJpegMetadata(readFileSync(strippedPath));
        writeFileSync(strippedPath, cleaned);
        const stored = cleaned;
        const sha = createHash('sha256').update(stored).digest('hex');
        const ctx: Ctx = { today: todayIso(), token };
        const { data, error } = await dbFor(ctx).rpc('register_orbit_photo', {
          p_child: childId,
          p_sha256: sha,
          p_path: basename(strippedPath),
        });
        if (error) {
          res.status(error.code === '42501' ? 403 : 400).json({ error: 'REFUSED' });
          return;
        }
        res.json({ photoId: String(data), bytes: stored.length, sha256: sha });
      } catch {
        res.status(400).json({ error: 'METADATA_STRIP_UNAVAILABLE' });
      } finally {
        if (existsSync(rawPath)) unlinkSync(rawPath);
      }
    },
  );


  /**
   * POST /api/demo/reset — restore the demo state.
   *
   * Lives HERE, not on Rosina, because the persona session cache is process-local to this server:
   * resetting elsewhere would restore the DB while leaving this process serving stale persona
   * sessions. Same guards as before: loopback only (until Task H), demo sessions only, the Demo guide
   * is refused, and one reset per person per 30 s.
   */
  // Village routing. The client sends PLACE IDS; authorization happens here first, and only then is
  // the cache or the network touched. See src/village/ors.ts for why row existence is not permission.
  app.post('/api/village/route', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = bearerToken(req.headers.authorization);
    if (!token) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    const identity = await verifyBearer(req.headers.authorization);
    if (!identity.ok || !identity.personId) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (!allowRoute(identity.personId)) { res.status(429).json({ error: 'RATE_LIMITED' }); return; }

    const childId = typeof req.body?.childId === 'string' ? req.body.childId : '';
    const fromPlaceId = typeof req.body?.fromPlaceId === 'string' ? req.body.fromPlaceId : '';
    const toPlaceId = typeof req.body?.toPlaceId === 'string' ? req.body.toPlaceId : '';
    if (!childId || !fromPlaceId || !toPlaceId) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }

    const ctx: Ctx = { today: todayIso(), token };
    const look = async (placeId: string) => {
      const { data, error } = await dbFor(ctx).rpc('place_route_geometry_for', { p_child: childId, p_place: placeId });
      if (error) return { kind: 'error' as const } satisfies PlaceLookup;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { id?: string; label?: string; state?: string; latitude?: number | null; longitude?: number | null }
        | null;
      if (!row?.id) return { kind: 'notfound' as const } satisfies PlaceLookup;
      return { kind: 'row' as const, row } satisfies PlaceLookup;
    };

    // The profile is part of what a route IS, so it is validated here and travels into cache identity.
    const profileRaw = req.body?.profile ?? 'driving-car';
    if (!isRouteProfile(profileRaw)) { res.status(400).json({ error: 'INVALID_PROFILE' }); return; }

    const [from, to] = await Promise.all([look(fromPlaceId), look(toPlaceId)]);
    // Every refusal — invisible, nonexistent, withheld, ungeocoded — is decided BEFORE any cache
    // read or ORS request. `decideRoute` is pure, so this ordering is testable without a network.
    const decision = decideRoute(from as PlaceLookup, to as PlaceLookup);
    if (!decision.ok) { res.status(decision.status).json(decision.body); return; }

    try {
      const route = await routeBetween(profileRaw, fromPlaceId, toPlaceId,
        { lat: decision.from.lat, lng: decision.from.lng },
        { lat: decision.to.lat, lng: decision.to.lng });

      // Persist the REAL road result so the ride estimate prices the SAME distance (one number, one
      // basis). A cache hit is not re-stored; a refusal never reaches this line at all. A storage
      // failure must not fail a route the family can already see, so it is logged and swallowed —
      // but it IS logged, because a silent failure here means ranking quietly stays on haversine.
      if (!route.cached) {
        try {
          // The RAW writer is no longer executable by a request-handling caller (0063); this is the
          // caller-authorized one. It re-checks parent/address.read on the child and refuses a
          // snapshot that is not a real place row for that child.
          await dbFor(ctx).rpc('store_route_result_authorized', {
            p_child: childId,
            p_profile: profileRaw,
            p_from_place_id: fromPlaceId,
            p_to_place_id: toPlaceId,
            p_from_lat: decision.from.lat,
            p_from_lng: decision.from.lng,
            p_to_lat: decision.to.lat,
            p_to_lng: decision.to.lng,
            p_distance_meters: route.distanceMeters,
            p_duration_seconds: route.durationSeconds,
          });
        } catch (storeError) {
          console.error('[village:route] road result not stored:',
            storeError instanceof Error ? storeError.message : 'unknown');
        }
      }

      res.status(200).json(route);
    } catch (e) {
      if (e instanceof RouteUnavailable) {
        res.status(503).json({ error: 'ROUTE_UNAVAILABLE', reason: e.reason });
        return;
      }
      res.status(503).json({ error: 'ROUTE_UNAVAILABLE', reason: 'UNEXPECTED' });
    }
  });

  /**
   * POST /api/village/day — the authorized day read, and the only source of DayPlan places.
   *
   * Body: { childId, day: 'YYYY-MM-DD' }. The caller's own bearer is forwarded to
   * `event_day_places`, which authorizes on that caller's claims — no schedule authority returns
   * ZERO ROWS, not an error, so "not shared with you" is indistinguishable from "nothing scheduled"
   * (that is the documented behaviour and it is not an oracle).
   *
   * A failed read is NOT an empty day: 503 DAY_UNAVAILABLE. `placeId`/`placeName` come only from the
   * accessor's `linked` state; `withheld` and `unlinked` both arrive null and are told apart by
   * `placeState`. No coordinates are read, returned or derivable here — geometry is 0058's business.
   */
  app.post('/api/village/day', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = bearerToken(req.headers.authorization);
    if (!token) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    const identity = await verifyBearer(req.headers.authorization);
    if (!identity.ok || !identity.personId) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }

    const childId = typeof req.body?.childId === 'string' ? req.body.childId : '';
    const day = typeof req.body?.day === 'string' ? req.body.day : '';
    if (!childId || !isDay(day)) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }

    const ctx: Ctx = { today: todayIso(), token };
    const read = await readDayPlan(dbDayTransport(ctx), { token, childId, day });
    if (!read.ok) { res.status(503).json({ error: 'DAY_UNAVAILABLE' }); return; }

    // The response carries the day plan only: no place geometry, no location text, no inference.
    res.status(200).json({ childId, date: read.plan.date, items: read.plan.items });
  });

  app.post('/api/demo/reset', async (req: Request, res: Response) => {
    // A reset response describes state that is about to change; caching it would outlive its truth.
    res.setHeader('Cache-Control', NO_STORE);
    if (!isLoopback(req.socket.remoteAddress ?? '')) {
      res.status(403).json({ error: 'LOOPBACK_ONLY' }); return;
    }
    const identity = await verifyBearer(req.header('authorization'));
    const refusal = identityRefusal(identity);
    if (refusal) { res.status(refusal.status).json(refusal.body); return; }
    // Defensive narrowing: `identityRefusal` refuses every non-ok case, so this is unreachable — but the
    // compiler needs the discriminated union narrowed before `personId` can be read.
    if (!identity.ok) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }

    const now = Date.now();
    const clientIp = resolveClientIp(req.socket.remoteAddress ?? '', req.header('x-forwarded-for'));
    const ipHits = (resetIpHits.get(clientIp) ?? []).filter((t) => now - t < RESET_IP_WINDOW_MS);
    const ipRefusal = windowRefusal(now, ipHits, RESET_IP_WINDOW_MS, RESET_IP_MAX, 'RESET_IP_RATE_LIMITED');
    if (ipRefusal) { res.status(ipRefusal.status).json(ipRefusal.body); return; }

    const last = lastResetAt.get(identity.personId) ?? 0;
    const throttled = cooldownRefusal(now, last, RESET_COOLDOWN_MS, 'RESET_RATE_LIMITED');
    if (throttled) { res.status(throttled.status).json(throttled.body); return; }

    // ONE lock for the shared resource. `resetDemo` rewrites people/households/grants/relationships/
    // shared_statuses, so a per-identity lock would let two resets run concurrently over the same rows.
    if (!resetLocks.tryAcquire(SHARED_RESET_LOCK)) {
      res.status(RESET_IN_FLIGHT.status).json(RESET_IN_FLIGHT.body); return;
    }
    lastResetAt.set(identity.personId, now);
    ipHits.push(now);
    resetIpHits.set(clientIp, ipHits);

    try {
      const { resetDemo } = await import('./reset');
      const report = await resetDemo(identity.personId);
      // Order matters: restore first, then drop the cache this process actually owns.
      dropPersonaSessionCache();
      res.status(200).json({ ok: true, ...report });
    } catch (error) {
      console.error(`[demo] reset failed: ${error instanceof Error ? error.message : 'unknown'}`);
      res.status(500).json({ error: 'RESET_FAILED' });
    } finally {
      // Released on EVERY path, so a failed reset cannot wedge the shared lock out of future attempts.
      resetLocks.release(SHARED_RESET_LOCK);
    }
  });

  // Method guard: `/api/demo/reset` is POST-only. Without this, a GET falls through to the parameterised
  // routes and answers 404, which reads like "no such endpoint" rather than "wrong method".
  app.all('/api/demo/reset', (req: Request, res: Response) => {
    res.setHeader('Allow', 'POST');
    res.setHeader('Cache-Control', NO_STORE);
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  });

  /**
   * POST /api/demo/family — create ONE sandbox family and its persona.
   *
   * Same guards as reset: loopback only (until Task H), a verified demo session, the Demo guide
   * refused (it is read-only), one creation per person every 5 s. The body is {parentName, childName}
   * only: no personId, no email, no role, no ids. Everything else is generated server-side.
   */
  app.post('/api/demo/family', async (req: Request, res: Response) => {
    const addr = req.socket.remoteAddress ?? '';
    if (!(addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1')) {
      res.status(403).json({ error: 'LOOPBACK_ONLY' }); return;
    }
    const identity = await verifyBearer(req.header('authorization'));
    if (!identity.ok) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (!identity.demo) { res.status(403).json({ error: 'DEMO_SESSION_REQUIRED' }); return; }
    if (identity.demoGuide) { res.status(403).json({ error: 'DEMO_GUIDE_READ_ONLY' }); return; }

    const now = Date.now();
    const last = lastFamilyAt.get(identity.personId) ?? 0;
    if (now - last < FAMILY_COOLDOWN_MS) {
      res.status(429).json({ error: 'FAMILY_RATE_LIMITED', retryAfterMs: FAMILY_COOLDOWN_MS - (now - last) }); return;
    }

    const body = req.body as { parentName?: unknown; childName?: unknown } | undefined;
    if (!cleanName(body?.parentName) || !cleanName(body?.childName)) {
      res.status(400).json({ error: 'INVALID_NAME' }); return;
    }
    lastFamilyAt.set(identity.personId, now);

    try {
      const family = await createDemoFamily({ parentName: body?.parentName, childName: body?.childName });
      console.log(`[demo-family] ${identity.personId} -> created ${family.id}`);
      res.status(201).json(family);
    } catch (error) {
      const code = error instanceof FamilyError ? error.code : 'FAMILY_CREATE_FAILED';
      const status = error instanceof FamilyError ? error.status : 500;
      console.error(`[demo-family] ${identity.personId} -> ${code}`);
      res.status(status).json({ error: code });
    }
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  // Keep the maps bounded; unref so the interval never holds the process open.
  const timer = setInterval(() => {
    prune(byIp, IP_WINDOW_MS);
    prune(byPersona, PERSONA_WINDOW_MS);
  }, 30_000);
  timer.unref();

  return app;
}

/**
 * Starts the endpoint on 127.0.0.1 only. Returns false when disabled, so main.ts can stay quiet in
 * a normal run.
 */
export async function startDemoLogin(): Promise<boolean> {
  if (process.env.DEMO_LOGIN_ENABLED !== '1') return false;
  if (process.env.NODE_ENV === 'production') {
    console.error('[demo-login] refusing to start with NODE_ENV=production');
    return false;
  }

  const port = Number(process.env.DEMO_LOGIN_PORT ?? 4008);
  const app = createDemoLoginApp();
  await new Promise<void>((resolve) => {
    app.listen(port, '127.0.0.1', resolve);
  });
  console.log(`[demo-login] local-only endpoint on http://127.0.0.1:${port}/api/demo/login`);
  return true;
}
