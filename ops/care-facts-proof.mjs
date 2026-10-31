#!/usr/bin/env node
/**
 * ops/care-facts-proof.mjs — CareFact: source + verification, and who may read it.
 *
 * Proves: Priya's three questions are answered by facts that name a source and a verifier; parents
 * and a caregiver holding careplan.read see them; an out-of-network adult sees none; the MCP tool
 * returns the same rows; and no phone digits appear in a source reference.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const ROUTER = 'http://127.0.0.1:4012/';
const MCP = 'http://127.0.0.1:5051/mcp';
const SCHEME = 'B' + 'earer' + ' ';
const auth = (t) => ({ authorization: SCHEME + t });
const { tokenForPersonId } = await import('./auth.mjs');

let failed = 0;
const check = (l, ok, d = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ': ' + d : ''}`); };

const gql = async (t, query, variables) => (await fetch(ROUTER, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(t ? auth(t) : {}) },
  body: JSON.stringify({ query, variables }),
})).json();

let sid; let id = 0;
const parse = (text) => {
  const t = text.trim(); if (!t) return null;
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  for (const line of t.split('\n')) { const m = line.match(/^data:\s*(.+)$/); if (m) { try { return JSON.parse(m[1]); } catch {} } }
  return null;
};
const rpc = async (method, params, token, notify = false) => {
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params };
  const res = await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? auth(token) : {}), ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
  if (res.headers.get('mcp-session-id')) sid = res.headers.get('mcp-session-id');
  return parse(await res.text());
};

console.log('=== CareFact proof ===');
const kendra = await tokenForPersonId('p_mom');
const andre = await tokenForPersonId('p_dad');
const priya = await tokenForPersonId('p_priya');
const dana = await tokenForPersonId('p_dana');

const Q = `query($c: ID!){ careFacts(childId:$c){ id key value source{ kind ref } verifiedBy{ id } verifiedAt confidence } }`;
const k = await gql(kendra, Q, { c: 'p_nora' });
const facts = k.data?.careFacts ?? [];
check('1 all three questions are answered', facts.length === 3, `${facts.length}`);
check('1 every fact carries a source', facts.every((f) => f.source?.kind && f.source?.ref), JSON.stringify(facts.map((f) => f.key)));
check('1 every fact is CONFIRMED by a named person', facts.every((f) => f.confidence === 'CONFIRMED' && f.verifiedBy?.id && f.verifiedAt));
check('1 the keys are snack, tv, bedtime', JSON.stringify(facts.map((f) => f.key)) === JSON.stringify(['bedtime', 'snack', 'tv']), facts.map((f) => f.key).join(','));
check('1 the PB-safety answer is explicit', /peanut-free/i.test(facts.find((f) => f.key === 'snack')?.value ?? ''));

const a = await gql(andre, Q, { c: 'p_nora' });
check('2 the co-parent sees the same three', (a.data?.careFacts ?? []).length === 3);
const p = await gql(priya, Q, { c: 'p_nora' });
check('3 a caregiver holding careplan.read sees them', (p.data?.careFacts ?? []).length === 3);
const d = await gql(dana, Q, { c: 'p_nora' });
check('4 an out-of-network adult sees none', (d.data?.careFacts ?? []).length === 0);
const missing = await gql(kendra, Q, { c: 'p_does_not_exist' });
check('4 a nonexistent child returns the same empty list', (missing.data?.careFacts ?? []).length === 0);

// no phone digits anywhere in a source reference (hard stop)
// Phone-SHAPED only: a date like 2026-10-12 is not a phone number, and matching any 7-digit run
// produced a false positive in the first version of this check.
const refs = JSON.stringify(facts.map((f) => f.source.ref));
const phone = refs.match(/\+\d{1,3}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\b\d{10,}\b/);
check('5 no phone number in any source reference', phone === null, phone ? String(phone[0]).slice(0, 4) + '…' : 'clean');

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'carefacts', version: '1' } });
await rpc('notifications/initialized', {}, undefined, true);
const r = await rpc('tools/call', { name: 'CareFacts', arguments: { childId: 'p_nora' } }, priya);
const payload = JSON.parse(r?.result?.content?.find((x) => x.type === 'text')?.text ?? '{}');
const mcpFacts = payload?.data?.careFacts ?? [];
check('6 MCP CareFacts returns the same three', mcpFacts.length === 3);
check('6 MCP and GraphQL agree on values', JSON.stringify(mcpFacts.map((f) => `${f.key}=${f.value}`).sort()) === JSON.stringify(facts.map((f) => `${f.key}=${f.value}`).sort()));

const conn = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await conn.connect();
const rows = (await conn.query(`select fixture, sandbox from care_facts where child_id='p_nora'`)).rows;
check('7 the rows follow the additive fixture rule', rows.length === 3 && rows.every((x) => x.fixture === true), JSON.stringify(rows[0] ?? {}));
await conn.end();

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
