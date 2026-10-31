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
import express, { type Request, type Response } from 'express';
import { loadEnv } from '../env';
import { verifyBearer } from '../auth/verify';
import { scenarioNowFrom } from '../context';
import { runRosinaTurn, type HistoryMessage } from './model';
import { createRateLimiter } from './rateLimit';
import { MuseConfigError, type ProviderId } from '../muse/providers';

loadEnv();

const PORT = Number(process.env.ROSINA_PORT ?? 4200);
const PROVIDER = (process.env.ROSINA_PROVIDER ?? 'meta') as ProviderId;
const MCP_URL = process.env.ROSINA_MCP_URL ?? 'http://127.0.0.1:5050/mcp';
const DEMO_CLOCK = process.env.DEMO_CLOCK === '1';
const TIMEOUT_MS = Number(process.env.ROSINA_TIMEOUT_MS ?? 30_000);
const RATE_LIMIT_PER_MIN = Number(process.env.ROSINA_RATE_LIMIT_PER_MIN ?? 20);

const limiter = createRateLimiter(RATE_LIMIT_PER_MIN);

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
    }).catch((error: unknown) => {
      console.error(`[rosina] turn failed person=${identity.personId} error=${error instanceof Error ? error.constructor.name : typeof error}: ${error instanceof Error ? error.message : 'unknown'}`);
      return null;
    }),
    TIMEOUT_MS,
  );

  if (outcome === TIMEOUT || outcome === null) {
    console.log(`[rosina] person=${identity.personId} route=${body.currentRoute} result=${outcome === TIMEOUT ? 'TIMEOUT' : 'ERROR'} latencyMs=${Date.now() - startedAt}`);
    res.status(200).json({ reply: "I couldn't check that just now.", actions: [] });
    return;
  }

  console.log(`[rosina] person=${identity.personId} route=${body.currentRoute} rounds=${outcome.rounds} tools=${outcome.toolCalls.map((t) => `${t.kind}:${t.name}${t.isError ? '!' : ''}`).join(',') || 'none'} actions=${outcome.actions.map((a) => a.id).join(',') || 'none'} outputGuardTriggered=${outcome.outputGuardTriggered} latencyMs=${Date.now() - startedAt}`);
  res.status(200).json({ reply: outcome.reply, actions: outcome.actions });
}

export function createRosinaApp() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  // A malformed JSON body reaches here as a SyntaxError from express.json(); treat it the same
  // as any other invalid request rather than letting Express's default HTML error page through.
  app.use((err: unknown, _req: Request, res: Response, next: (err?: unknown) => void) => {
    if (err instanceof SyntaxError) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    next(err);
  });
  app.post('/api/rosina', (req, res) => {
    handleRosina(req, res).catch((error: unknown) => {
      console.error(`[rosina] unhandled: ${error instanceof Error ? error.message : 'unknown'}`);
      if (!res.headersSent) res.status(200).json({ reply: "I couldn't check that just now.", actions: [] });
    });
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (PROVIDER !== 'meta' && PROVIDER !== 'baseten') {
    console.error(`[rosina] BLOCKED: ROSINA_PROVIDER must be "meta" or "baseten", got "${PROVIDER}"`);
    process.exit(2);
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
