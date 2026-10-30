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
import { getPersonaSession, publicPersonaSession } from './persona-sessions';

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

  app.get('/api/demo/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      localOnly: true,
      personas: DEMO_PERSONAS.map((p) => ({ personaId: p.id, ready: isReady(p) })),
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
    const persona = personaById(personaId);
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
