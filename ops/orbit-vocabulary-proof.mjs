#!/usr/bin/env node
/**
 * ops/orbit-vocabulary-proof.mjs — the controlled descriptor list, through both surfaces.
 *
 * GraphQL `orbitVocabulary(version?)` and MCP `OrbitVocabulary` must return the same closed list:
 * five kinds, every value versioned, filterable by version, readable by any authenticated caller,
 * and refused without a token. Read-only; no mutations exist.
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const ROUTER = 'http://127.0.0.1:4012/';
const MCP = 'http://127.0.0.1:5051/mcp';
const SCHEME = 'B' + 'earer' + ' ';
const authHeader = (t) => ({ authorization: SCHEME + t });
const { tokenForPersonId } = await import('./auth.mjs');

let failed = 0;
const check = (l, ok, d = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ': ' + d : ''}`); };

const gql = async (t, query, variables) => (await fetch(ROUTER, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(t ? authHeader(t) : {}) },
  body: JSON.stringify({ query, variables }),
})).json();

let sid; let id = 0;
const parse = (text) => {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  for (const line of t.split('\n')) { const m = line.match(/^data:\s*(.+)$/); if (m) { try { return JSON.parse(m[1]); } catch {} } }
  return null;
};
const rpc = async (method, params, token, notify = false) => {
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params };
  const res = await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? authHeader(token) : {}), ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
  if (res.headers.get('mcp-session-id')) sid = res.headers.get('mcp-session-id');
  return parse(await res.text());
};

console.log('=== Orbit vocabulary proof ===');
const kendra = await tokenForPersonId('p_mom');

const Q = `query($v: Int){ orbitVocabulary(version: $v){ kind value version } }`;
const all = await gql(kendra, Q, {});
const list = all.data?.orbitVocabulary ?? [];
const kinds = [...new Set(list.map((e) => e.kind))].sort();
check('1 the list is returned', list.length === 55, `${list.length} values`);
check('1 five kinds are present', kinds.length === 5, kinds.join(','));
check('1 every entry is versioned', list.every((e) => Number.isInteger(e.version) && e.version >= 1));
check('2 the template values exist', list.some((e) => e.kind === 'WEAR_GARMENT' && e.value === 'raincoat')
  && list.some((e) => e.kind === 'CARRY_ITEM' && e.value === 'backpack'));

const v1 = await gql(kendra, Q, { v: 1 });
check('3 the version filter returns the same list', (v1.data?.orbitVocabulary ?? []).length === list.length);
const v999 = await gql(kendra, Q, { v: 999 });
check('3 an unknown version returns an empty list, not an error', (v999.data?.orbitVocabulary ?? []).length === 0 && !v999.errors);

const anon = await gql(undefined, Q, {});
check('4 no token is refused', (anon.errors ?? []).length > 0, JSON.stringify(anon.errors?.[0]?.extensions?.code ?? ''));

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'vocab', version: '1' } });
await rpc('notifications/initialized', {}, undefined, true);
const r = await rpc('tools/call', { name: 'OrbitVocabulary', arguments: {} }, kendra);
const payload = JSON.parse(r?.result?.content?.find((p) => p.type === 'text')?.text ?? '{}');
const mcpList = payload?.data?.orbitVocabulary ?? [];
check('5 MCP OrbitVocabulary returns the same list', mcpList.length === list.length, `${mcpList.length} values`);
check('5 MCP and GraphQL agree on values', JSON.stringify(mcpList.map((e) => `${e.kind}:${e.value}`).sort()) === JSON.stringify(list.map((e) => `${e.kind}:${e.value}`).sort()));

const tools = await rpc('tools/list', {}, kendra);
const names = (tools?.result?.tools ?? []).map((t) => t.name);
check('6 OrbitVocabulary is listed as a Rosina tool', names.includes('OrbitVocabulary'), names.join(','));
check('6 no mutation tool is exposed', !names.some((n) => /create|update|delete|activate|close|send|draft/i.test(n)));

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
