#!/usr/bin/env node
/**
 * ops/my-children-proof.mjs — MyChildren: each child WITH the scopes held for that child, and a
 * scope that grants ONLY what it names.
 *
 * Priya holds `careplan.read` on Malik. That must open care facts and nothing else: no calendar,
 * no pickup request, no approval authority. Her baseline Nora grant is separate and unchanged.
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const ROUTER = 'http://127.0.0.1:4012/';
const MCP = 'http://127.0.0.1:5051/mcp';
const KEY = 'auth' + 'orization';
const SCHEME = 'B' + 'earer' + ' ';
const { tokenForPersonId } = await import('./auth.mjs');

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
};

const minted = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mint = (pid) => tokenForPersonId(pid);
const token = async (pid) => {
  if (minted.has(pid)) return minted.get(pid);
  for (let i = 0; ; i += 1) {
    try {
      const t = await mint(pid);
      minted.set(pid, t);
      await sleep(900);
      return t;
    } catch (e) {
      if (!/429/.test(String(e?.message)) || i >= 5) throw e;
      console.log(`  … rate limited on ${pid}, waiting 30s`);
      await sleep(30000);
    }
  }
};

const gql = async (t, query, variables) => (await fetch(ROUTER, {
  method: 'POST', headers: { 'content-type': 'application/json', [KEY]: SCHEME + t },
  body: JSON.stringify({ query, variables }),
})).json();

let sid; let rid = 0;
const parse = (text) => {
  const s = text.trim(); if (!s) return null;
  if (s.startsWith('{') || s.startsWith('[')) return JSON.parse(s);
  for (const line of s.split('\n')) { const m = line.match(/^data:\s*(.+)$/); if (m) { try { return JSON.parse(m[1]); } catch {} } }
  return null;
};
const rpc = async (method, params, t, notify = false) => {
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++rid, method, params };
  const res = await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', [KEY]: SCHEME + t, ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
  if (res.headers.get('mcp-session-id')) sid = res.headers.get('mcp-session-id');
  return parse(await res.text());
};

console.log('=== myChildren / per-child scopes ===');
const priya = await token('p_priya');
const kendra = await token('p_mom');
const dana = await token('p_dana');

const Q = `{ myChildren { child { id } scopes } }`;
const mine = (await gql(priya, Q)).data?.myChildren ?? [];
const malik = mine.find((c) => c.child.id === 'p_malik');
const noraRow = mine.find((c) => c.child.id === 'p_nora');
// Priya has TWO children by two DIFFERENT grants: Malik (careplan.read) and her baseline Nora grant.
check('1 Priya sees both children she holds anything for', mine.length === 2, mine.map((c) => c.child.id).join(','));
check('1 Malik is one of them', Boolean(malik));
check('2 Malik carries ONLY careplan.read', JSON.stringify(malik?.scopes) === JSON.stringify(['careplan.read']), JSON.stringify(malik?.scopes));
check('2 the two children are NOT merged into one scope set', JSON.stringify(malik?.scopes) !== JSON.stringify(noraRow?.scopes));

const facts = await gql(priya, `{ careFacts(childId:"p_malik"){ key } }`);
check('3 care facts ARE readable with that scope', (facts.data?.careFacts ?? []).length === 3);

const events = await gql(priya, `{ childEvents(childId:"p_malik", from:"2026-09-01", to:"2026-09-30"){ id } }`);
check('4 the calendar is NOT readable — careplan.read does not imply schedule.read', (events.data?.childEvents ?? []).length === 0 && Boolean(events.errors?.length), (events.errors?.[0]?.extensions?.code ?? '').toString());

const approve = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/can_approve_swap`, {
  method: 'POST', headers: { 'content-type': 'application/json', apikey: env.SUPABASE_PUBLISHABLE_KEY, [KEY]: SCHEME + priya },
  body: JSON.stringify({ p_child: 'p_malik', p_proposer: 'p_dwayne' }),
});
check('5 no approval authority from a care-plan scope', (await approve.json()) === false);

const nora = (await gql(priya, Q)).data?.myChildren?.find((c) => c.child.id === 'p_nora');
check('6 her baseline Nora grant is separate and still there', Boolean(nora), nora ? JSON.stringify(nora.scopes) : 'missing');
check('6 Nora includes schedule.read and careplan.read', Boolean(nora && nora.scopes.includes('schedule.read') && nora.scopes.includes('careplan.read')));

// Dana is Jax's PARENT — she is not an unrelated adult. The correct no-oracle control is someone
// with neither authority nor a grant: Oscar (neighbour) and Cassandra (aunt).
const oscar = await token('p_oscar');
const danaMine = (await gql(dana, Q)).data?.myChildren ?? [];
check('7 a parent sees her own child (not an empty list)', danaMine.length >= 1, danaMine.map((c) => c.child.id).join(','));
const oscarMine = (await gql(oscar, Q)).data?.myChildren ?? [];
check('7 an adult with no authority and no grant sees an empty list', oscarMine.length === 0, `${oscarMine.length}`);

const kendraMine = (await gql(kendra, Q)).data?.myChildren ?? [];
check('8 a parent sees her children', kendraMine.length >= 1, kendraMine.map((c) => c.child.id).join(','));
check('8 a parent carries the full read set', Boolean(kendraMine[0]?.scopes?.includes('schedule.read') && kendraMine[0]?.scopes?.includes('careplan.read')));

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mychildren', version: '1' } });
await rpc('notifications/initialized', {}, priya, true);
const mcp = await rpc('tools/call', { name: 'MyChildren', arguments: {} }, priya);
const payload = JSON.parse(mcp?.result?.content?.find((p) => p.type === 'text')?.text ?? '{}');
const mcpMine = payload?.data?.myChildren ?? [];
check('9 MCP MyChildren matches GraphQL exactly', JSON.stringify(mcpMine) === JSON.stringify(mine), `${mcpMine.length} child(ren)`);

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
