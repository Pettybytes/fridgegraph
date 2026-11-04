import {createPinPreferencesHandler} from './pinPreferences';
/**
 * POST /api/rosina — the live Ask Rosina service.
 *
 *   tsx src/rosina/server.ts        (or: npm run rosina)
 *
 * Contract: docs/contracts/ask-rosina.md. This process holds no identity of its own: every
 * request's bearer token is forwarded to MCP exactly as received (src/rosina/model.ts) and never
 * otherwise used to act. History arrives with each request and is discarded when the request
 * finishes — nothing here persists a conversation, a token, or message content. Only
 * non-content metadata (route, resolved person id, tool names, latencies, HTTP status) reaches
 * the console.
 */
import { join } from 'node:path';
import express, { type Request, type Response } from 'express';
import { loadEnv } from '../env';
import { verifyBearer } from '../auth/verify';
import { scenarioNowFrom } from '../context';
import { runRosinaTurn, type HistoryMessage, type TurnEvent } from './model';
import { createRateLimiter } from './rateLimit';
import { createTtlCache } from './turnCache';
import type { ChildAccess } from './childAccess';
import type { McpTool } from '../muse/mcp';
import { MuseConfigError, resolveProvider, type ProviderId } from '../muse/providers';
import { createPhotoDescriptorsHandler } from './photoEndpoint';
import { createMuseVisionClient, MUSE_VISION_MODEL } from './museVision';
import { buildPhotoDeps } from './photoDeps';
import type { VisionClient } from './photoDescriptors';
import { createNoticePlanHandlers } from './noticeEndpoint';
import { createSparkNoticeExtractor } from './noticeExtractor';
import { buildScheduleReader, buildPickupRequester, requireGraphqlUrl } from './noticeDeps';
import { createInviteHandler } from './inviteEndpoint';
import { createFixtureImageGenerator, createLiveImageGenerator } from './inviteImage';
import { createInviteRateLimiter } from './inviteBudget';
import { createSparkInviteExtractor, buildInviteParentAuthorizer } from './inviteDeps';
import { createPinHandlers } from './pinEndpoint';
import { buildPinDeps } from './pinDeps';
import { pinIntakeReadiness } from './pinReadiness';
import { buildInviteLedgerBudget } from './inviteLedgerBudget';
import { createInviteDedup } from './inviteDedup';

loadEnv();

// Same private photo directory the demo upload/photo-GET path uses.
const ORBIT_PHOTO_DIR = process.env.ORBIT_PHOTO_DIR ?? join(process.cwd(), 'var', 'orbit-photos');
// Private directory for pin media (EXIF-stripped bytes; never a public bucket).
const PIN_MEDIA_DIR = process.env.PIN_MEDIA_DIR ?? join(process.cwd(), 'var', 'pin-media');

const PORT = Number(process.env.ROSINA_PORT ?? 4200);
const PROVIDER = (process.env.ROSINA_PROVIDER ?? 'meta') as ProviderId;
const MCP_URL = process.env.ROSINA_MCP_URL ?? 'http://127.0.0.1:5050/mcp';
const DEMO_CLOCK = process.env.DEMO_CLOCK === '1';
const TIMEOUT_MS = Number(process.env.ROSINA_TIMEOUT_MS ?? 30_000);
const RATE_LIMIT_PER_MIN = Number(process.env.ROSINA_RATE_LIMIT_PER_MIN ?? 20);

// Notice → Plan. The router GraphQL endpoint is reached AS THE CALLER (bearer forwarded, never a
// service key). It has NO default and NO MCP fallback (requireGraphqlUrl) — the MCP port is not a
// GraphQL endpoint, so a derived default silently broke every notice request with 502. The signing
// key is required too — without it the feature stays OFF rather than signing with an insecure
// default. Scenario reference date is explicit (contract §3.3).
const NOTICE_GRAPHQL_URL = (process.env.ROSINA_GRAPHQL_URL ?? '').trim();
const NOTICE_SIGNING_KEY = process.env.ROSINA_PROPOSAL_SIGNING_KEY ?? '';
const NOTICE_SCENARIO_DATE = process.env.ROSINA_NOTICE_SCENARIO_DATE ?? '2026-10-26';

// Invites (slim). Field extraction uses Muse Spark; image is a FIXTURE by default, live muse-image-1.0
// only behind INVITE_LIVE=1 (UNVERIFIED — reconfirm Meta's image docs first). Parent authz runs AS
// THE CALLER against the router (ROSINA_GRAPHQL_URL). Budget is per-CHILD and persistent (0085,
// STAGED) — the daily cap itself lives in the DB (household_policies 'invite_daily_budget_usd',
// default $1.00/day), not here; a new login sharing the same child shares the same budget.
const INVITE_LIVE = process.env.INVITE_LIVE === '1';
const INVITE_RATE_PER_MIN = Number(process.env.INVITE_RATE_LIMIT_PER_MIN ?? 6);
// Settlement is trusted server work, not a caller-reported fact (0085) — this secret proves a
// settleInviteBudget call genuinely came from this process, which alone observed the real
// provider outcome. Never logged, never sent to any client. Required only when INVITE_LIVE=1
// (FIXTURE never reserves/settles at all, so the secret is otherwise unused).
const INVITE_SETTLEMENT_SECRET = process.env.INVITE_SETTLEMENT_HMAC_SECRET ?? '';

const limiter = createRateLimiter(RATE_LIMIT_PER_MIN);

// 2026-11-03 latency order: short-TTL turn caches (see src/rosina/turnCache.ts for the safety
// posture; every real read still runs as the caller; only the prompt's roster view is cached).
const MYCHILDREN_TTL_MS = Number(process.env.ROSINA_MYCHILDREN_TTL_MS ?? 30_000);
const myChildrenCache = createTtlCache<ChildAccess[]>(MYCHILDREN_TTL_MS);
const toolListCache = createTtlCache<McpTool[]>(300_000);

const TIMEOUT = Symbol('timeout');

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMEOUT), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(TIMEOUT); },
    );
  });
}

type RosinaRequestBody = { message: string; currentRoute: string; history: HistoryMessage[] };

function parseBody(body: unknown): RosinaRequestBody | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.message !== 'string' || b.message.trim() === '' || b.message.length > 4000) return null;
  if (typeof b.currentRoute !== 'string' || b.currentRoute.length > 500) return null;
  if (!Array.isArray(b.history) || b.history.length > 40) return null;
  const history: HistoryMessage[] = [];
  for (const item of b.history) {
    if (!item || typeof item !== 'object') return null;
    const h = item as Record<string, unknown>;
    if ((h.role !== 'user' && h.role !== 'assistant') || typeof h.content !== 'string' || h.content.length > 4000) return null;
    history.push({ role: h.role, content: h.content });
  }
  return { message: b.message, currentRoute: b.currentRoute, history };
}

async function handleRosina(req: Request, res: Response): Promise<void> {
  const identity = await verifyBearer(req.header('authorization'));
  if (!identity.ok) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }

  const body = parseBody(req.body);
  if (!body) {
    res.status(400).json({ error: 'INVALID_REQUEST' });
    return;
  }

  if (!limiter.allow(identity.personId)) {
    res.status(429).json({ error: 'RATE_LIMITED' });
    return;
  }

  const bearer = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const startedAt = Date.now();

  // Streaming transport: Accept: text/event-stream gets SSE (status/token/replace events while
  // the turn runs, then one `final` event carrying EXACTLY the JSON the non-streaming path
  // returns). Token text is provisional; `final` is always authoritative. The legacy JSON path
  // is unchanged for every other caller (voice turn server, tests, older builds).
  const wantsStream = (req.header('accept') ?? '').includes('text/event-stream');
  let sendEvent: ((type: string, payload: unknown) => void) | null = null;
  if (wantsStream) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    let open = true;
    res.on('close', () => { open = false; });
    sendEvent = (type, payload) => { if (open) res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`); };
    // First byte well under the 300 ms budget, before any model or MCP work starts.
    sendEvent('status', { label: 'Reading your question' });
  }
  const onEvent = sendEvent
    ? (event: TurnEvent) => {
      if (event.kind === 'token') sendEvent!('token', { text: event.text });
      else if (event.kind === 'status') sendEvent!('status', { label: event.label });
      else sendEvent!('replace', {});
    }
    : undefined;

  const outcome = await withTimeout(
    runRosinaTurn({
      message: body.message,
      currentRoute: body.currentRoute,
      history: body.history,
      bearer,
      personId: identity.personId,
      isGuide: identity.demoGuide,
      provider: PROVIDER,
      mcpUrl: MCP_URL,
      scenarioNow: scenarioNowFrom(req.headers as Record<string, string | string[] | undefined>, DEMO_CLOCK),
      onEvent,
      myChildrenCache,
      toolListCache,
    }).catch((error: unknown) => {
      console.error(`[rosina] turn failed person=${identity.personId} error=${error instanceof Error ? error.constructor.name : typeof error}: ${error instanceof Error ? error.message : 'unknown'}`);
      return null;
    }),
    TIMEOUT_MS,
  );

  if (outcome === TIMEOUT || outcome === null) {
    console.log(`[rosina] person=${identity.personId} route=${body.currentRoute} result=${outcome === TIMEOUT ? 'TIMEOUT' : 'ERROR'} latencyMs=${Date.now() - startedAt}`);
    const fallback = { reply: "I couldn't check that just now.", actions: [], schoolReportProposal: null, addVillagerProposal: null };
    if (sendEvent) { sendEvent('final', fallback); res.end(); return; }
    res.status(200).json(fallback);
    return;
  }

  console.log(`[rosina] person=${identity.personId} route=${body.currentRoute} rounds=${outcome.rounds} tools=${outcome.toolCalls.map((t) => `${t.kind}:${t.name}${t.isError ? '!' : ''}`).join(',') || 'none'} actions=${outcome.actions.map((a) => a.id).join(',') || 'none'} outputGuardTriggered=${outcome.outputGuardTriggered} stream=${wantsStream} firstAnswerMs=${outcome.firstAnswerMs ?? 'n/a'} latencyMs=${Date.now() - startedAt}`);
  const payload = {
    reply: outcome.reply,
    actions: outcome.actions,
    schoolReportProposal: outcome.schoolReportProposal,
    addVillagerProposal: outcome.addVillagerProposal,
  };
  if (sendEvent) {
    // Time-to-useful-answer, measured server-side: first VALIDATED chunk, not first byte.
    sendEvent('meta', { firstAnswerMs: outcome.firstAnswerMs, totalMs: Date.now() - startedAt });
    sendEvent('final', payload);
    res.end();
    return;
  }
  res.status(200).json(payload);
}

export function createRosinaApp() {
  const app = express();
  const jsonSmall = express.json({ limit: '64kb' });
  // The notice-plan routes carry an image/PDF, so they parse their own (larger) body; every other
  // route keeps the 64kb cap. Mounting this as a gate keeps the global cap off exactly those paths.
  app.use((req: Request, res: Response, next: (err?: unknown) => void) => {
    // notice-plan (PDF/photo), invite (optional reference image) and pin/upload (photo) carry an
    // image, so they parse their own (larger) body; every other route keeps the 64kb cap.
    if (
      req.path.startsWith('/api/rosina/notice-plan') ||
      req.path === '/api/rosina/invite' ||
      req.path === '/api/rosina/pin/upload'
    ) { next(); return; }
    jsonSmall(req, res, next);
  });
  // A malformed JSON body reaches here as a SyntaxError from express.json(); treat it the same
  // as any other invalid request rather than letting Express's default HTML error page through.
  app.use((err: unknown, _req: Request, res: Response, next: (err?: unknown) => void) => {
    if (err instanceof SyntaxError) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    next(err);
  });
  app.post('/api/rosina', (req, res) => {
    handleRosina(req, res).catch((error: unknown) => {
      console.error(`[rosina] unhandled: ${error instanceof Error ? error.message : 'unknown'}`);
      const fallback = { reply: "I couldn't check that just now.", actions: [], schoolReportProposal: null };
      if (!res.headersSent) { res.status(200).json(fallback); return; }
      // An SSE response already has headers out; close it with an authoritative final event.
      try { res.write(`event: final\ndata: ${JSON.stringify(fallback)}\n\n`); } catch { /* stream already gone */ }
      res.end();
    });
  });

  // Photo → vocabulary-constrained descriptor suggestions (PR F). The vision client is real
  // (Meta muse-spark-1.3) when configured; authorization, the EXIF-stripped photo store and the
  // controlled vocabulary are now the real production wiring (buildPhotoDeps) — every decision is
  // made with the caller's own bearer through an RLS-scoped client (no service-role).
  let vision: VisionClient | null = null;
  try {
    const c = resolveProvider('meta');
    vision = createMuseVisionClient({ apiKey: c.apiKey, baseUrl: c.baseUrl, model: MUSE_VISION_MODEL });
  } catch { vision = null; }
  const photoHandler = createPhotoDescriptorsHandler(buildPhotoDeps({
    verify: async (h) => { const id = await verifyBearer(h); return id.ok ? { ok: true, personId: id.personId } : { ok: false }; },
    rateLimiter: limiter,
    vision,
    photoDir: ORBIT_PHOTO_DIR,
  }));
  app.post('/api/rosina/photo-descriptors', (req, res) => {
    photoHandler(req, res).catch(() => { if (!res.headersSent) res.status(502).json({ error: 'VISION_ERROR' }); });
  });

  // Notice → Plan: prepare a review-only proposal, confirm it server-side. OFF unless a signing key
  // and a model provider are both configured — no insecure default key, no guessed provider.
  let noticeHandlers: ReturnType<typeof createNoticePlanHandlers> | null = null;
  if (NOTICE_SIGNING_KEY) {
    try {
      const graphqlUrl = requireGraphqlUrl(); // throws if ROSINA_GRAPHQL_URL unset — never MCP-derived
      const c = resolveProvider('meta');
      noticeHandlers = createNoticePlanHandlers({
        verify: async (h) => { const id = await verifyBearer(h); return id.ok ? { ok: true, personId: id.personId } : { ok: false }; },
        rateLimiter: limiter,
        scheduleReader: buildScheduleReader({ graphqlUrl }),
        extractor: createSparkNoticeExtractor({ apiKey: c.apiKey, baseUrl: c.baseUrl, model: c.model }),
        requestPickup: buildPickupRequester({ graphqlUrl }),
        signingKey: NOTICE_SIGNING_KEY,
        scenarioDate: NOTICE_SCENARIO_DATE,
      });
    } catch (err) {
      noticeHandlers = null;
      console.log(`[rosina] notice-plan OFF: ${err instanceof Error ? err.message : 'configuration error'}`);
    }
  }
  if (noticeHandlers) {
    const jsonLarge = express.json({ limit: '12mb' });
    const h = noticeHandlers;
    app.post('/api/rosina/notice-plan', jsonLarge, (req, res) => {
      h.prepare(req, res).catch(() => { if (!res.headersSent) res.status(502).json({ error: 'NOTICE_ERROR' }); });
    });
    app.post('/api/rosina/notice-plan/confirm', jsonLarge, (req, res) => {
      h.confirm(req, res).catch(() => { if (!res.headersSent) res.status(502).json({ error: 'NOTICE_ERROR' }); });
    });
    // Body-parser errors on the large routes (too large / malformed) — the early handler is before
    // these routes and won't see them, so map them here.
    app.use('/api/rosina/notice-plan', (err: unknown, _req: Request, res: Response, next: (err?: unknown) => void) => {
      if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') { res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' }); return; }
      if (err instanceof SyntaxError) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
      next(err);
    });
  } else {
    console.log('[rosina] notice-plan OFF (set ROSINA_PROPOSAL_SIGNING_KEY and a model provider to enable)');
  }

  // Invites (slim). Needs a model provider (Spark extraction) and the router URL (parent authz).
  // Image is a labelled FIXTURE unless INVITE_LIVE=1. OFF (logged) if either dependency is missing.
  try {
    const c = resolveProvider('meta');
    const graphqlUrl = requireGraphqlUrl(); // router, as the caller — same as notice-plan
    if (INVITE_LIVE && !INVITE_SETTLEMENT_SECRET) {
      throw new Error('INVITE_SETTLEMENT_HMAC_SECRET is required when INVITE_LIVE=1 — settlement must be provably server-controlled (0085)');
    }
    const image = INVITE_LIVE
      ? createLiveImageGenerator({ apiKey: c.apiKey, baseUrl: c.baseUrl })
      : createFixtureImageGenerator();
    const inviteHandler = createInviteHandler({
      verify: async (h) => { const id = await verifyBearer(h); return id.ok ? { ok: true, personId: id.personId, demoGuide: id.demoGuide } : { ok: false }; },
      authorizeParent: buildInviteParentAuthorizer({ graphqlUrl }),
      extractor: createSparkInviteExtractor({ apiKey: c.apiKey, baseUrl: c.baseUrl, model: c.model }),
      image,
      rateLimiter: createInviteRateLimiter(INVITE_RATE_PER_MIN),
      dedup: createInviteDedup(),
      // Per-CHILD persistent budget (0085) — only ever called when source is MUSE_IMAGE;
      // FIXTURE spends nothing and never reaches it.
      // No cost is passed in — price is decided server-side only, inside the 0085 RPCs.
      // settlementSecret proves a settle() call genuinely came from this process (see 0085's
      // hmac check) — required above whenever INVITE_LIVE=1.
      ledgerBudget: buildInviteLedgerBudget({ graphqlUrl, settlementSecret: INVITE_SETTLEMENT_SECRET }),
      source: INVITE_LIVE ? 'MUSE_IMAGE' : 'FIXTURE',
    });
    // The global gate above deliberately skips this path so a reference image can exceed 64kb;
    // that means this route MUST mount its own JSON parser or `req.body` is undefined and every
    // request is a 400. 12mb covers a 5 MB reference after base64 inflation (~6.7 MB) plus JSON.
    const jsonInvite = express.json({ limit: '12mb' });
    app.post('/api/rosina/invite', jsonInvite, (req, res) => {
      inviteHandler(req, res).catch(() => { if (!res.headersSent) res.status(502).json({ error: 'IMAGE_FAILED' }); });
    });
    // Route-level parser errors (oversized / malformed) — the early handler is mounted before this
    // route so it never sees them; map them to the contract's codes instead of Express's HTML page.
    app.use('/api/rosina/invite', (err: unknown, _req: Request, res: Response, next: (err?: unknown) => void) => {
      if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') { res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' }); return; }
      if (err instanceof SyntaxError) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
      next(err);
    });
  } catch (err) {
    console.log(`[rosina] invites OFF: ${err instanceof Error ? err.message : 'configuration error'}`);
  }

  // Pin it to the fridge: real private media + Muse Spark extraction (behind PIN_LIVE) + persistence
  // into #157's fridge_notes. OFF unless a signing key and the router URL are configured (parent
  // authz + the confirm HMAC). The readiness probe is ALWAYS mounted (default OFF) so the web can
  // check capability without the actions being live. Nothing content-bearing is logged — only the
  // extraction's metadata provenance.
  const preferences = createPinPreferencesHandler();
  const preferenceRequest = (req: Request, res: Response) => {
    preferences(req, res).catch(() => { if (!res.headersSent) res.status(503).json({ error: 'PREFERENCES_UNAVAILABLE' }); });
  };
  app.get('/api/rosina/pin/preferences', preferenceRequest);
  app.post('/api/rosina/pin/preferences', preferenceRequest);
  let pinHandlers: ReturnType<typeof createPinHandlers> | null = null;
  if (NOTICE_SIGNING_KEY) {
    try {
      const graphqlUrl = requireGraphqlUrl();
      pinHandlers = createPinHandlers(buildPinDeps({
        graphqlUrl,
        signingKey: NOTICE_SIGNING_KEY,
        mediaDir: PIN_MEDIA_DIR,
        log: (p) => console.log(`[rosina] pin extraction source=${p.source} model=${p.model ?? 'none'} kind=${String(p.kind)} confidence=${String(p.confidence)}`),
      }));
    } catch (err) {
      pinHandlers = null;
      console.log(`[rosina] pin OFF: ${err instanceof Error ? err.message : 'configuration error'}`);
    }
  }
  if (pinHandlers) {
    const p = pinHandlers;
    const pinJsonLarge = express.json({ limit: '16mb' });
    app.post('/api/rosina/pin/upload', pinJsonLarge, (req, res) => {
      p.upload(req, res).catch(() => { if (!res.headersSent) res.status(502).json({ error: 'PIN_ERROR' }); });
    });
    app.post('/api/rosina/pin', (req, res) => {
      p.prepare(req, res).catch(() => { if (!res.headersSent) res.status(502).json({ error: 'PIN_ERROR' }); });
    });
    app.post('/api/rosina/pin/confirm', (req, res) => {
      p.confirm(req, res).catch(() => { if (!res.headersSent) res.status(502).json({ error: 'PIN_ERROR' }); });
    });
    app.get('/api/rosina/pin/media/:id', (req, res) => {
      p.download(req, res).catch(() => { if (!res.headersSent) res.status(404).json({ error: 'NOT_FOUND' }); });
    });
    app.get('/api/rosina/pin/readiness', (req, res) => p.readiness(req, res));
    app.use('/api/rosina/pin/upload', (err: unknown, _req: Request, res: Response, next: (err?: unknown) => void) => {
      if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') { res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' }); return; }
      if (err instanceof SyntaxError) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
      next(err);
    });
  } else {
    app.get('/api/rosina/pin/readiness', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(pinIntakeReadiness());
    });
    console.log('[rosina] pin OFF (set ROSINA_PROPOSAL_SIGNING_KEY and ROSINA_GRAPHQL_URL to enable; PIN_LIVE=1 for real extraction)');
  }

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (PROVIDER !== 'meta' && PROVIDER !== 'baseten') {
    console.error(`[rosina] BLOCKED: ROSINA_PROVIDER must be "meta" or "baseten", got "${PROVIDER}"`);
    process.exit(2);
  }
  // Fail fast: notice-plan enabled (signing key set) but no router URL. No MCP-derived default — a
  // silent fallback to the MCP port made every notice request fail closed with 502 (deploy incident).
  if (NOTICE_SIGNING_KEY && !NOTICE_GRAPHQL_URL) {
    try { requireGraphqlUrl(); } catch (err) {
      console.error(`[rosina] BLOCKED: ${err instanceof Error ? err.message : 'ROSINA_GRAPHQL_URL is required'}`);
      process.exit(2);
    }
  }
  try {
    const { resolveProvider } = await import('../muse/providers');
    resolveProvider(PROVIDER);
  } catch (error) {
    if (error instanceof MuseConfigError) {
      console.error(`[rosina] BLOCKED ${error.message}`);
      process.exit(2);
    }
    throw error;
  }
  createRosinaApp().listen(PORT, '127.0.0.1', () => {
    console.log(`[rosina] listening on 127.0.0.1:${PORT} provider=${PROVIDER} mcp=${MCP_URL} timeoutMs=${TIMEOUT_MS} rateLimitPerMin=${RATE_LIMIT_PER_MIN}`);
  });
}
