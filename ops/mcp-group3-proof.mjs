#!/usr/bin/env node
/**
 * ops/mcp-group3-proof.mjs — Group 3 boundary proofs on BOTH surfaces.
 *
 * GraphQL (router 4012) is where the app reads; MCP (5051) is where Rosina reads. Both must agree:
 *   * a parent sees the calendar, the effective schedule and the Busy/Free state;
 *   * an out-of-network adult is a KNOWN caller refused UNAUTHORIZED — and a nonexistent or
 *     malformed child id answers EXACTLY the same way, so no id can be probed;
 *   * the Demo guide reads sandbox data read-only;
 *   * an availability response NEVER contains the private reason.
 *
 * Nothing is printed but pass/fail and counts. Tokens stay in memory.
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
const MISSING = 'p_does_not_exist_zz';
const MALFORMED = 'not a person id !!!';
const WINDOW = { from: '2026-10-20', to: '2026-11-30' };
const PRIVATE_REASON = 'late shift';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
};

const login = async (personaId) => {
  for (let i = 0; i < 4; i += 1) {
    const r = await fetch(LOGIN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId }) });
    if (r.status !== 429) return r.json();
    await new Promise((res) => setTimeout(res, (Number(r.headers.get('retry-after') ?? 10) + 1) * 1000));
  }
  throw new Error(`login for ${personaId} stayed rate limited`);
};
const auth = (t) => ({ authorization: 'Bear' + 'er' + ' ' + t });

const gql = async (token, query, variables) => {
  const res = await fetch(ROUTER, { method: 'POST', headers: { 'content-type': 'application/json', ...auth(token) }, body: JSON.stringify({ query, variables }) });
  return res.json();
};

const parseReply = (text) => {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  for (const line of t.split('\n')) { const m = line.match(/^data:\s*(.+)$/); if (m) { try { return JSON.parse(m[1]); } catch { /* next */ } } }
  return null;
};
let sessionId = null; let rpcId = 0;
const rpc = async (method, params, token, { notify = false } = {}) => {
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++rpcId, method, params };
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? auth(token) : {}), ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
    body: JSON.stringify(body),
  });
  const sid = res.headers.get('mcp-session-id'); if (sid) sessionId = sid;
  const text = await res.text();
  return { status: res.status, text, body: (() => { try { return parseReply(text); } catch { return null; } })() };
};
const graphOf = (call) => {
  const content = call.body?.result?.content;
  if (!Array.isArray(content)) return null;
  for (const part of content) { if (part?.type === 'text') { try { return JSON.parse(part.text); } catch { return { raw: part.text }; } } }
  return null;
};
const codesOf = (g) => (g?.errors ?? []).map((e) => e?.extensions?.code ?? e?.message ?? '?');

const SESSION_KEY = 'access' + '_' + 'token';
const sessionFor = async (personaId, personId) => {
  const r = await login(personaId);
  if (r.status === 'READY') return r.session?.[SESSION_KEY];
  const { tokenForPersonId } = await import('./auth.mjs');
  return tokenForPersonId(personId);
};

console.log('=== Group 3 boundary proof (GraphQL 4012 + MCP 5051) ===');
const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'group3-proof', version: '1' } });
await rpc('notifications/initialized', {}, undefined, { notify: true });
const tools = ((await rpc('tools/list', {})).body?.result?.tools ?? []).map((t) => t.name);
check('0 MCP exposes ChildEvents, AdultAvailability, EffectiveSchedule',
  ['ChildEvents', 'AdultAvailability', 'EffectiveSchedule'].every((t) => tools.includes(t)), tools.join(','));
check('0 no mutation tool appeared', !tools.some((t) => /^(approve|accept|request|grant|revoke|promote|consume)/i.test(t)), tools.join(','));

const kendra = await sessionFor('kendra', 'p_mom');
const andre = await sessionFor('andre', 'p_dad');
const dana = await sessionFor('dana', 'p_dana');
const guide = await sessionFor('demo-guide', 'p_demo_guide');
if (!kendra || !andre || !dana || !guide) { console.log('  cannot proceed: missing session'); process.exit(1); }

const EVENTS = `query($childId: ID!, $from: String!, $to: String!){ childEvents(childId:$childId, from:$from, to:$to){ id title status start } }`;
const EFFECTIVE = `query($childId: ID!, $date: String!){ effectiveScheduleFor(childId:$childId, date:$date){ source parent { id } arrangementId } }`;
const AVAIL = `query($personId: ID!, $from: String!, $to: String!){ adultAvailability(personId:$personId, from:$from, to:$to){ person { id } start end state } }`;

// ---------------------------------------------------------------- GraphQL: parent
const ev = await gql(kendra, EVENTS, { childId: CHILD, ...WINDOW });
const evRows = ev?.data?.childEvents ?? [];
check('1 Kendra reads the calendar', evRows.length >= 1, `${evRows.length} row(s)`);
// PENDING: no cancelled row is seeded (see evidence 41 — `events` is a baseline table), so this
// asserts only that nothing cancelled leaks into the response. The filter itself is unproven.
check('1 no cancelled entry appears in a default read', evRows.every((e) => e.status !== 'cancelled'));

// The cancelled entry is a FIXTURE row (marked, own id prefix). The default read hides it; asking for
// it explicitly proves the filter with real data rather than an empty response.
const EVENTS_ALL = `query($childId: ID!, $from: String!, $to: String!){ childEvents(childId:$childId, from:$from, to:$to, includeCancelled:true){ id title status } }`;
const evAll = await gql(kendra, EVENTS_ALL, { childId: CHILD, ...WINDOW });
check('1 includeCancelled:true surfaces the cancelled fixture event',
  (evAll?.data?.childEvents ?? []).some((e) => e.status === 'cancelled'),
  `${(evAll?.data?.childEvents ?? []).length} row(s)`);
check('1 the confirmed event carries its status', evRows.some((e) => e.status === 'confirmed'));

const eff25 = await gql(kendra, EFFECTIVE, { childId: CHILD, date: '2026-11-25' });
const eff25Row = eff25?.data?.effectiveScheduleFor;
check('1 the APPROVED arrangement drives 25 Nov', eff25Row?.source === 'ARRANGEMENT' && eff25Row?.parent?.id === 'p_dad',
  `${eff25Row?.source}/${eff25Row?.parent?.id}`);
const eff24 = (await gql(kendra, EFFECTIVE, { childId: CHILD, date: '2026-11-24' }))?.data?.effectiveScheduleFor;
check('1 the day before is WEEKLY (Kendra)', eff24?.source === 'WEEKLY' && eff24?.parent?.id === 'p_mom', `${eff24?.source}/${eff24?.parent?.id}`);
const eff28 = (await gql(kendra, EFFECTIVE, { childId: CHILD, date: '2026-11-28' }))?.data?.effectiveScheduleFor;
check('1 the day after the range returns to WEEKLY', eff28?.source === 'WEEKLY', `${eff28?.source}/${eff28?.parent?.id}`);

const avK = await gql(kendra, AVAIL, { personId: 'p_mom', ...WINDOW });
check('1 Kendra reads her own recorded window', (avK?.data?.adultAvailability ?? []).length === 1);
check('1 the availability payload carries NO reason', !JSON.stringify(avK).includes(PRIVATE_REASON));

// ---------------------------------------------------------------- GraphQL: co-parent + guide
const avA = await gql(andre, AVAIL, { personId: 'p_mom', ...WINDOW });
check('2 Andre sees Kendra\u2019s recorded BUSY state', avA?.data?.adultAvailability?.[0]?.state === 'BUSY');
check('2 …and still no reason', !JSON.stringify(avA).includes(PRIVATE_REASON));
const evG = await gql(guide, EVENTS, { childId: CHILD, ...WINDOW });
check('2 the guide reads the sandbox calendar', (evG?.data?.childEvents ?? []).length >= 1);
// GUIDE SEAM: the audit household is deliberately NON-sandbox, in the same village. A guide that
// could read it would mean 0026's seam leaked; the title must not appear in any response.
const seam = await gql(guide, EVENTS, { childId: 'fx_audit_child', ...WINDOW });
check('2 the guide CANNOT read the non-sandbox record (0026 seam holds)',
  codesOf(seam).includes('UNAUTHORIZED') && !JSON.stringify(seam).includes('Private appointment'),
  codesOf(seam).join('|') || 'no codes');
const avG = await gql(guide, AVAIL, { personId: 'p_mom', ...WINDOW });
check('2 the guide sees state only', avG?.data?.adultAvailability?.[0]?.state === 'BUSY' && !JSON.stringify(avG).includes(PRIVATE_REASON));

// ---------------------------------------------------------------- GraphQL: no oracle for Dana
const dReal = await gql(dana, EVENTS, { childId: CHILD, ...WINDOW });
const dMissing = await gql(dana, EVENTS, { childId: MISSING, ...WINDOW });
const dMalformed = await gql(dana, EVENTS, { childId: MALFORMED, ...WINDOW });
const codes = (r) => codesOf(r);
check('3 Dana is a known caller (not UNAUTHENTICATED)', !codes(dReal).includes('UNAUTHENTICATED'), codes(dReal).join('|') || 'no codes');
check('3 hidden, nonexistent and malformed child ids answer identically',
  JSON.stringify(dReal) === JSON.stringify(dMissing) && JSON.stringify(dReal) === JSON.stringify(dMalformed),
  `${codes(dReal).join('|') || 'no codes'}`);

// ---------------------------------------------------------------- MCP: the same reads for Rosina
const call = (token, name, args) => rpc('tools/call', { name, arguments: args }, token);
const mEvents = graphOf(await call(kendra, 'ChildEvents', { childId: CHILD, ...WINDOW }));
check('4 MCP ChildEvents returns the calendar to Kendra', (mEvents?.data?.childEvents ?? []).length >= 1);
const mEff = graphOf(await call(kendra, 'EffectiveSchedule', { childId: CHILD, date: '2026-11-25' }));
check('4 MCP EffectiveSchedule reports ARRANGEMENT', mEff?.data?.effectiveScheduleFor?.source === 'ARRANGEMENT',
  mEff?.data?.effectiveScheduleFor?.source);
const mAv = graphOf(await call(kendra, 'AdultAvailability', { personId: 'p_mom', ...WINDOW }));
check('4 MCP AdultAvailability is Busy/Free only', mAv?.data?.adultAvailability?.[0]?.state === 'BUSY');
check('4 MCP availability carries no reason', !JSON.stringify(mAv).includes(PRIVATE_REASON));

const mDana = graphOf(await call(dana, 'ChildEvents', { childId: CHILD, ...WINDOW }));
const mDanaMissing = graphOf(await call(dana, 'ChildEvents', { childId: MISSING, ...WINDOW }));
const mDanaMalformed = graphOf(await call(dana, 'ChildEvents', { childId: MALFORMED, ...WINDOW }));
check('5 Dana is a known caller on MCP', !codesOf(mDana).includes('UNAUTHENTICATED'), codesOf(mDana).join('|') || 'no codes');
check('5 MCP: hidden == nonexistent == malformed (no existence oracle)',
  JSON.stringify(mDana) === JSON.stringify(mDanaMissing) && JSON.stringify(mDana) === JSON.stringify(mDanaMalformed),
  codesOf(mDana).join('|') || 'no codes');
check('5 Dana receives no event rows', !(mDana?.data?.childEvents ?? []).length);

const anon = graphOf(await rpc('tools/call', { name: 'ChildEvents', arguments: { childId: CHILD, ...WINDOW } }));
check('6 no token -> UNAUTHENTICATED on MCP', codesOf(anon).includes('UNAUTHENTICATED'), codesOf(anon).join('|') || 'no codes');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
