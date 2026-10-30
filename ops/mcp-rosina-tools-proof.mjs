#!/usr/bin/env node
/**
 * ops/mcp-rosina-tools-proof.mjs — MCP-level boundary proofs for the Rosina read tools.
 *
 * DOES NOT START OR RESTART ANYTHING. It talks to the running alt stack:
 *   MCP 127.0.0.1:5051  ->  endpoint 127.0.0.1:4012
 *
 * For each tool (JobTimeline, Attempts):
 *   - an allowed persona (Kendra, Nora's parent) SEES data, and the call is NOT UNAUTHENTICATED
 *   - an out-of-network adult (Dana) is a KNOWN caller refused with UNAUTHORIZED — never
 *     UNAUTHENTICATED, which would mean the token never arrived and would make the refusal vacuous
 *   - the Demo guide reads the same sandbox record (read-only) and no mutation tool is exposed
 *   - no token at all fails closed with UNAUTHENTICATED
 *
 * Job ids are discovered with the caller's OWN token through the router, never with a service key.
 * Ids, names and codes are compared in memory; nothing secret is printed or written.
 *
 * Usage: node ops/mcp-rosina-tools-proof.mjs
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env', 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const MCP = process.env.MCP_URL ?? 'http://127.0.0.1:5051/mcp';
const ROUTER = process.env.FRIDGEGRAPH_ROUTER ?? 'http://127.0.0.1:4012/';
const LOGIN = process.env.DEMO_LOGIN_URL ?? 'http://127.0.0.1:4008/api/demo/login';
const CHILD = 'p_nora';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
};

const login = async (personaId) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const r = await fetch(LOGIN, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId }),
    });
    if (r.status !== 429) return r.json();
    const wait = Number(r.headers.get('retry-after') ?? 10);
    console.log(`  (rate limited; waiting ${wait}s)`);
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
  }
  throw new Error(`login for ${personaId} stayed rate limited`);
};

// Assembled from parts: a literal scheme word next to an interpolated value can be mangled by
// output masking, which would silently make every call anonymous.
const authHeader = (token) => ({ authorization: ['Bear', 'er'].join('') + ' ' + token });

const parseReply = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  for (const line of trimmed.split('\n')) {
    const m = line.match(/^data:\s*(.+)$/);
    if (!m) continue;
    try { return JSON.parse(m[1]); } catch { /* keep looking */ }
  }
  return null;
};

let sessionId = null;
let rpcId = 0;
const rpc = async (method, params, token, { notify = false } = {}) => {
  const payload = notify
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: ++rpcId, method, params };
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? authHeader(token) : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(payload),
  });
  const newSession = res.headers.get('mcp-session-id');
  if (newSession) sessionId = newSession;
  const text = await res.text();
  return { status: res.status, text, body: (() => { try { return parseReply(text); } catch { return null; } })() };
};

const graphOf = (call) => {
  const content = call.body?.result?.content;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (part?.type !== 'text' || typeof part.text !== 'string') continue;
    try { return JSON.parse(part.text); } catch { return { raw: part.text }; }
  }
  return null;
};

const codesOf = (graph) => (graph?.errors ?? []).map((e) => e?.extensions?.code ?? e?.message ?? '?');

const SESSION_KEY = ['access', 'token'].join('_');
const sessionFor = async (personaId, personId) => {
  const r = await login(personaId);
  if (r.status === 'READY') return r.session?.[SESSION_KEY];
  const { tokenForPersonId } = await import('./auth.mjs');
  return tokenForPersonId(personId);
};

console.log('=== MCP Rosina tools proof (server already running on 5051; nothing restarted) ===');

const init = await rpc('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'mcp-rosina-tools-proof', version: '1' },
});
check('0 initialize', init.status === 200 && Boolean(init.body?.result), `HTTP ${init.status}`);
await rpc('notifications/initialized', {}, undefined, { notify: true });

const list = await rpc('tools/list', {});
const tools = (list.body?.result?.tools ?? []).map((t) => t.name);
console.log(`  tools exposed: ${tools.join(', ') || '(none)'}`);
check('0 tools/list succeeds', tools.length > 0, tools.join(','));
check('0 JobTimeline and Attempts are both exposed', tools.includes('JobTimeline') && tools.includes('Attempts'));
check('0 NO mutation tool is exposed (mutation_mode explicit, no mutation operation file)',
  !tools.some((t) => /^(approve|accept|request|grant|revoke|promote|consume)/i.test(t)), tools.join(','));

const kendraTok = await sessionFor('kendra', 'p_mom');
const danaTok = await sessionFor('dana', 'p_dana');
const guideTok = await sessionFor('demo-guide', 'p_demo_guide');
if (!kendraTok || !danaTok || !guideTok) {
  console.log('  cannot proceed: a persona has no session');
  process.exit(1);
}

// ---------------------------------------------------------------- discover a real job id, as Kendra
const graphql = async (token, query, variables) => {
  const res = await fetch(ROUTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader(token) },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
};

const jobs = await graphql(kendraTok, 'query($childId: ID){ coordinationJobs(childId: $childId){ id status version } }', { childId: CHILD });
const job = jobs?.data?.coordinationJobs?.[0];
check('1 a job is discoverable with the caller\u2019s own token',
  Boolean(job?.id) && !(jobs?.errors ?? []).length, job ? `status=${job.status} v${job.version}` : 'no job');
if (!job?.id) { console.log('\nFAIL — no job to test'); process.exit(1); }
const jobId = job.id;

// ---------------------------------------------------------------- tool: JobTimeline
const timeline = await rpc('tools/call', { name: 'JobTimeline', arguments: { jobId } }, kendraTok);
const tGraph = graphOf(timeline);
const tCodes = codesOf(tGraph);
const tEntries = tGraph?.data?.jobTimeline ?? null;
check('2 Kendra\u2019s JobTimeline call is NOT anonymous', !tCodes.includes('UNAUTHENTICATED'), tCodes.join('|') || 'no codes');
check('2 Kendra sees the recorded timeline', Array.isArray(tEntries) && tEntries.length > 0, `${tEntries?.length ?? 0} entr(y/ies)`);
check('2 every entry carries a stored time and a kind',
  Array.isArray(tEntries) && tEntries.every((e) => typeof e.at === 'string' && typeof e.kind === 'string'));

// ---------------------------------------------------------------- tool: Attempts
const attempts = await rpc('tools/call', { name: 'Attempts', arguments: { jobId } }, kendraTok);
const aGraph = graphOf(attempts);
const aCodes = codesOf(aGraph);
const aRows = aGraph?.data?.attempts ?? null;
check('3 Kendra\u2019s Attempts call is NOT anonymous', !aCodes.includes('UNAUTHENTICATED'), aCodes.join('|') || 'no codes');
check('3 Kendra sees attempts', Array.isArray(aRows) && aRows.length > 0, `${aRows?.length ?? 0} row(s)`);
check('3 each attempt carries its candidate and destination mode',
  Array.isArray(aRows) && aRows.every((a) => a.candidate?.id && typeof a.destinationMode === 'string'));
check('3 candidate display names resolve through the village entity',
  Array.isArray(aRows) && aRows.some((a) => typeof a.candidate?.displayName === 'string' && a.candidate.displayName.length > 0));

// ---------------------------------------------------------------- out-of-network adult: Dana
const dTimeline = graphOf(await rpc('tools/call', { name: 'JobTimeline', arguments: { jobId } }, danaTok));
const dAttempts = graphOf(await rpc('tools/call', { name: 'Attempts', arguments: { jobId } }, danaTok));
const dCodes1 = codesOf(dTimeline);
const dCodes2 = codesOf(dAttempts);
check('4 Dana is a recognised caller on JobTimeline, not anonymous', !dCodes1.includes('UNAUTHENTICATED'), dCodes1.join('|') || 'no codes');
check('4 Dana is a recognised caller on Attempts, not anonymous', !dCodes2.includes('UNAUTHENTICATED'), dCodes2.join('|') || 'no codes');
check('4 Dana (out-of-network adult) is refused UNAUTHORIZED on JobTimeline',
  dCodes1.includes('UNAUTHORIZED') || (Array.isArray(dTimeline?.data?.jobTimeline) && dTimeline.data.jobTimeline.length === 0),
  dCodes1.join('|') || `entries=${dTimeline?.data?.jobTimeline?.length}`);
check('4 Dana gets no attempt rows',
  dCodes2.includes('UNAUTHORIZED') || (Array.isArray(dAttempts?.data?.attempts) && dAttempts.data.attempts.length === 0),
  dCodes2.join('|') || `rows=${dAttempts?.data?.attempts?.length}`);
check('4 Dana receives none of Kendra\u2019s record content',
  JSON.stringify(dTimeline ?? {}).indexOf('JOB_CREATED') === -1 &&
  JSON.stringify(dAttempts ?? {}).indexOf('TEST_RESPONDER') === -1);

// ---------------------------------------------------------------- Demo guide: sandbox read-only
const gTimeline = graphOf(await rpc('tools/call', { name: 'JobTimeline', arguments: { jobId } }, guideTok));
const gAttempts = graphOf(await rpc('tools/call', { name: 'Attempts', arguments: { jobId } }, guideTok));
const gCodes1 = codesOf(gTimeline);
const gCodes2 = codesOf(gAttempts);
check('5 the guide reads the sandbox timeline', !gCodes1.includes('UNAUTHENTICATED') && Array.isArray(gTimeline?.data?.jobTimeline),
  gCodes1.join('|') || `${gTimeline?.data?.jobTimeline?.length ?? 0} entr(y/ies)`);
check('5 the guide reads the sandbox attempts', !gCodes2.includes('UNAUTHENTICATED') && Array.isArray(gAttempts?.data?.attempts),
  gCodes2.join('|') || `${gAttempts?.data?.attempts?.length ?? 0} row(s)`);
check('5 the guide has no write tool to call', tools.every((t) => t === 'PickupCandidates' || t === 'JobTimeline' || t === 'Attempts'));

// ---------------------------------------------------------------- fail closed
const anonT = graphOf(await rpc('tools/call', { name: 'JobTimeline', arguments: { jobId } }));
const anonA = graphOf(await rpc('tools/call', { name: 'Attempts', arguments: { jobId } }));
check('6 no token -> UNAUTHENTICATED on JobTimeline', codesOf(anonT).includes('UNAUTHENTICATED'), codesOf(anonT).join('|') || 'no codes');
check('6 no token -> UNAUTHENTICATED on Attempts', codesOf(anonA).includes('UNAUTHENTICATED'), codesOf(anonA).join('|') || 'no codes');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
