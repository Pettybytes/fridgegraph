/**
 * Gate B test bridge — isolated, OFF by default.
 * Runs the pinned #280 core (9fc40f92) as its own process on PORT (default 4231).
 * No baseline service (web 5189, Rosina 4200, router, backend, DB) is touched.
 *
 * This repo copy mirrors the wiring Bentley deployed on 2026-11-04 and adds
 * the Retell custom-LLM WebSocket ingress (src/rosina/retellWsAdapter.ts) at
 * /gate-b/llm/{call_id}: the labelled clone's llm_websocket_url points at
 * wss://<tunnel>/gate-b/llm?session=<token from POST /gate-b/bind> so each
 * call resolves its bound parent session. Secrets arrive via env only.
 */
import http from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { RetellBridge, signPayload } from '../src/rosina/retellBridge.ts';
import { handleRetellWsUpgrade } from '../src/rosina/retellWsAdapter.ts';

try { process.loadEnvFile('.env'); } catch { /* env may be exported */ }
const PORT = Number(process.env.GATE_B_PORT ?? 4231);
const BRIDGE_SHA = '9fc40f92';
const ENABLED = process.env.GATE_B_ENABLED === '1';
if (!ENABLED) { console.log('[gate-b] disabled (GATE_B_ENABLED!=1); no listener started'); process.exit(0); }
const SECRET = process.env.GATE_B_BRIDGE_SECRET;
if (!SECRET) { console.error('[gate-b] GATE_B_BRIDGE_SECRET missing; refusing to start'); process.exit(2); }
const GRAPHQL_URL = process.env.GATE_B_GRAPHQL_URL ?? 'http://127.0.0.1:4010/';
const ROSINA_URL = process.env.GATE_B_ROSINA_URL ?? 'http://127.0.0.1:4200/api/rosina';
const DB_URL = (process.env.SUPABASE_DB_URL ?? readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))?.slice(17) ?? '').replace(/["'\s\r]/g, '');
const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const sessions = new Map(); // sid -> {session, bearer, exp}
const b64 = (v) => Buffer.from(v).toString('base64url');
const hmac = (v) => createHmac('sha256', SECRET).update(v).digest('hex');
function mintSession(session, bearer) {
  const sid = randomUUID(); const exp = Date.now() + 15 * 60_000;
  sessions.set(sid, { session, bearer, exp });
  const payload = b64(JSON.stringify({ sid, exp, personId: session.personId, childId: session.childId, childIds: session.childIds }));
  return { token: `${payload}.${hmac(payload)}`, exp };
}
function readSession(token) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || sig.length !== hmac(payload).length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(hmac(payload)))) return null;
  let p; try { p = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  const rec = sessions.get(p.sid);
  if (!rec || rec.exp < Date.now()) { sessions.delete(p.sid); return null; }
  return rec;
}
function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
async function body(req, limit = 64_000) { let n = 0; const chunks = []; for await (const c of req) { n += c.length; if (n > limit) throw new Error('TOO_LARGE'); chunks.push(c); } return Buffer.concat(chunks).toString('utf8'); }
async function gql(token, query) {
  const r = await fetch(GRAPHQL_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.errors) return null;
  return j.data;
}
function subOf(token) { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub ?? null; } catch { return null; } }

const bridge = new RetellBridge({
  secret: SECRET,
  runTurn: async ({ message, session }) => {
    const rec = [...sessions.values()].find((s) => s.session.personId === session.personId && s.session.childId === session.childId);
    if (!rec) throw new Error('SESSION_GONE');
    const r = await fetch(ROSINA_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${rec.bearer}` }, body: JSON.stringify({ message, currentRoute: '/voice', history: [] }), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error('ROSINA_UNAVAILABLE');
    const out = await r.json().catch(() => null);
    const a = Array.isArray(out?.actions) && out.actions.length ? out.actions[0] : null;
    rec.action = a;
    return {
      reply: String(out?.reply ?? ''),
      actions: [], // fast-model actions are never accepted by the bridge
      intent: a ? { description: String(a.proposedChange?.summary ?? ''), sourceFacts: Array.isArray(a.sourceFacts) ? a.sourceFacts : [], childId: a.childId, affectedPeople: Array.isArray(a.affectedPeople) ? a.affectedPeople : [] } : undefined,
    };
  },
  writeProposal: async ({ intent, session }) => {
    const rec = [...sessions.values()].find((s) => s.session.personId === session.personId && s.session.childId === session.childId);
    const a = rec?.action;
    if (!a) return null;
    if (!session.childIds.includes(a.childId)) return null;
    return { intent: String(a.intent ?? 'calendar.create'), childId: a.childId, sourceFacts: a.sourceFacts ?? intent.sourceFacts, summary: String(a.proposedChange?.summary ?? intent.description), args: a.proposedChange?.args ?? {}, affectedPeople: a.affectedPeople ?? [] };
  },
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/gate-b/health') {
      return json(res, 200, { ok: true, enabled: true, bridge: BRIDGE_SHA, port: PORT, rosina_url: ROSINA_URL });
    }
    if (req.method === 'POST' && req.url === '/gate-b/bind') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!token) return json(res, 401, { error: 'UNAUTHORIZED' });
      const data = await gql(token, '{ myChildren { child { id } } }');
      if (!data?.myChildren) return json(res, 401, { error: 'UNAUTHORIZED' });
      const childIds = data.myChildren.map((m) => String(m.child.id));
      const sub = subOf(token);
      const who = sub ? await db.query('select person_id from identity_map where user_id=$1 limit 1', [sub]) : { rows: [] };
      const personId = who.rows[0]?.person_id;
      if (!personId) return json(res, 401, { error: 'UNBOUND_PERSON' });
      let payload; try { payload = JSON.parse(await body(req)); } catch { return json(res, 400, { error: 'BAD_JSON' }); }
      const childId = String(payload?.childId ?? '');
      if (!childIds.includes(childId)) return json(res, 403, { error: 'CHILD_NOT_AUTHORIZED' });
      const { token: sessionToken, exp } = mintSession({ personId, childId, childIds }, token);
      return json(res, 200, { sessionToken, expiresAt: new Date(exp).toISOString(), personId, childId, childIds });
    }
    if (req.method === 'POST' && req.url === '/gate-b/turn') {
      const raw = await body(req);
      const ts = Number(req.headers['x-bridge-timestamp']); const sig = String(req.headers['x-bridge-signature'] ?? '');
      const expected = signPayload(SECRET, ts, raw);
      if (!Number.isFinite(ts) || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return json(res, 401, { error: 'BAD_SIGNATURE' });
      let p; try { p = JSON.parse(raw); } catch { return json(res, 400, { error: 'BAD_JSON' }); }
      const rec = readSession(p.sessionToken);
      if (!rec) return json(res, 401, { error: 'SESSION_EXPIRED' });
      const inner = JSON.stringify({ callId: p.callId, turn: p.turn, message: p.message, session: rec.session });
      const innerTs = Date.now();
      const out = await bridge.handle(inner, { 'x-bridge-timestamp': String(innerTs), 'x-bridge-signature': signPayload(SECRET, innerTs, inner) });
      return json(res, out.status, out.body);
    }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (e) {
    const code = e?.message === 'TOO_LARGE' ? 413 : 500;
    return json(res, code, { error: code === 413 ? 'TOO_LARGE' : 'INTERNAL' });
  }
});
server.on('upgrade', (req, socket) => {
  const handled = handleRetellWsUpgrade(req, socket, {
    bridge,
    secret: SECRET,
    resolveSession: ({ sessionToken }) => {
      const rec = sessionToken ? readSession(sessionToken) : null;
      return rec ? rec.session : null;
    },
  });
  if (!handled) socket.destroy();
});
server.listen(PORT, '127.0.0.1', () => console.log(`[gate-b] bridge ${BRIDGE_SHA} on 127.0.0.1:${PORT}`));
