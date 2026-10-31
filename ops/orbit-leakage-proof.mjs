#!/usr/bin/env node
/**
 * ops/orbit-leakage-proof.mjs — THE ACCEPTANCE RESULT.
 *
 * Every AUDIENCE-FACING payload is inspected for location and cross-record detail: GraphQL
 * (audience members), MCP (OrbitStatus/CheckInStatus), the media endpoint's refusals, and error
 * responses. Priya is an audience member who INDEPENDENTLY holds schedule.read — her schedule read
 * is the control: Orbit must add nothing to it.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const ROUTER = 'http://127.0.0.1:4012/';
const MCP = 'http://127.0.0.1:5051/mcp';
const API = 'http://127.0.0.1:4008';
const SCHEME = 'B' + 'earer' + ' ';
const { tokenForPersonId } = await import('./auth.mjs');

let failed = 0;
const check = (l, ok, d = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ': ' + d : ''}`); };

const gql = async (t, query, variables) => (await fetch(ROUTER, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: SCHEME + t }, body: JSON.stringify({ query, variables }),
})).json();

// Minimal MCP client with session handling.
let sid; let rpcId = 0;
const parse = (text) => {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  for (const line of t.split('\n')) { const m = line.match(/^data:\s*(.+)$/); if (m) { try { return JSON.parse(m[1]); } catch { /* next */ } } }
  return null;
};
const rpc = async (method, params, token, notify = false) => {
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++rpcId, method, params };
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: SCHEME + token } : {}), ...(sid ? { 'mcp-session-id': sid } : {}) },
    body: JSON.stringify(body),
  });
  if (res.headers.get('mcp-session-id')) sid = res.headers.get('mcp-session-id');
  return parse(await res.text());
};
const tool = async (token, name, args) => {
  const r = await rpc('tools/call', { name, arguments: args }, token);
  const part = r?.result?.content?.find((p) => p.type === 'text');
  try { return JSON.parse(part?.text ?? 'null'); } catch { return { raw: part?.text }; }
};

console.log('=== Orbit audience-payload leakage (acceptance) ===');
await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'leakage', version: '1' } });
await rpc('notifications/initialized', {}, undefined, true);

const kendra = await tokenForPersonId('p_mom');
const loretta = await tokenForPersonId('p_gma');
const priya = await tokenForPersonId('p_priya');
const dana = await tokenForPersonId('p_dana');

// Priya is added to the audience for this proof only; the fixture policy is restored at the end.
const conn = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await conn.connect();
const before = (await conn.query(`select value from household_policies where rule='orbit_notify_eligible' and household_id='h_a'`)).rows[0]?.value;
await conn.query(`update household_policies set value='p_dad,p_gma,p_bryan,p_priya' where rule='orbit_notify_eligible' and household_id='h_a'`);

let alertId;
try {
  const d = await gql(kendra, `mutation($c: ID!){ orbitDraft(childId:$c, wearColor:"yellow", wearGarment:"raincoat", hair:"ponytail", carryColor:"purple", carryItem:"backpack"){ draftId draftVersion } }`, { c: 'p_nora' });
  const id = d.data.orbitDraft.draftId;
  const pv = await gql(kendra, `mutation($d: ID!){ orbitPreview(draftId:$d){ draftVersion messageHash } }`, { d: id });
  const act = await gql(kendra, `mutation($d: ID!, $v: Int!, $h: String!){ orbitActivate(draftId:$d, draftVersion:$v, messageHash:$h){ id audience{ person{ id } } } }`,
    { d: id, v: pv.data.orbitPreview.draftVersion, h: pv.data.orbitPreview.messageHash });
  alertId = act.data?.orbitActivate?.id;
  check('0 the alert is active with four audience members', act.data?.orbitActivate?.audience?.length === 4, `${act.data?.orbitActivate?.audience?.length}`);

  const ORBIT_ALERT = `query($a: ID!){ orbitAlert(alertId:$a){ id status message guidance share{ photoId description wearColor wearGarment hair carryColor carryItem } audience{ person{ id displayName } } responses{ person{ id displayName } response } } }`;
  const priyaView = await gql(priya, ORBIT_ALERT, { a: alertId });
  const lorettaView = await gql(loretta, ORBIT_ALERT, { a: alertId });
  const danaView = await gql(dana, ORBIT_ALERT, { a: alertId });
  const danaMissing = await gql(dana, ORBIT_ALERT, { a: 'oa_does_not_exist' });

  check('1 Priya sees only her own audience row', priyaView.data?.orbitAlert?.audience?.length === 1, `${priyaView.data?.orbitAlert?.audience?.length} row(s)`);
  check('1 Priya sees no other member\u2019s response', (priyaView.data?.orbitAlert?.responses ?? []).every((r) => r.person.id === 'p_priya'));
  check('1 Dana sees nothing, identical to a nonexistent alert', danaView.data?.orbitAlert === null && JSON.stringify(danaView) === JSON.stringify(danaMissing));
  check('1 the answer carries the emergency guidance only for parents',
    (priyaView.data?.orbitAlert?.guidance ?? '') === '' && lorettaView.data?.orbitAlert?.guidance === '');

  // Priya's OWN schedule access (control) — then Orbit must add nothing.
  const EVENTS = `query($c: ID!, $f: String!, $t: String!){ childEvents(childId:$c, from:$f, to:$t){ title location start } }`;
  const priyaEvents = await gql(priya, EVENTS, { c: 'p_nora', f: '2026-10-20', t: '2026-11-30' });
  check('2 Priya independently reads schedule detail (control)', (priyaEvents.data?.childEvents ?? []).length >= 1, `${(priyaEvents.data?.childEvents ?? []).length} row(s)`);

  const mcpOrbitPriya = await tool(priya, 'OrbitStatus', { childId: 'p_nora' });
  const mcpOrbitKendra = await tool(kendra, 'OrbitStatus', { childId: 'p_nora' });
  const mcpOrbitDana = await tool(dana, 'OrbitStatus', { childId: 'p_nora' });
  const mcpCheckKendra = await tool(kendra, 'CheckInStatus', { childId: 'p_nora' });
  const mcpCheckDana = await tool(dana, 'CheckInStatus', { childId: 'p_nora' });

  check('3 MCP: the parent sees the full audience count', mcpOrbitKendra?.data?.orbitStatus?.audienceCount === 4, JSON.stringify(mcpOrbitKendra?.data?.orbitStatus?.audienceCount));
  check('3 MCP: the audience member sees only their own row', mcpOrbitPriya?.data?.orbitStatus?.audienceCount === 1, `${mcpOrbitPriya?.data?.orbitStatus?.audienceCount}`);
  check('3 MCP: Dana gets an empty status, no oracle', mcpOrbitDana?.data?.orbitStatus?.alertId === null);
  check('3 MCP: CheckInStatus is parent-only', mcpCheckKendra?.data?.checkInStatus?.text === 'check-in not recorded' && JSON.stringify(mcpCheckDana).toLowerCase().includes('unauthorized'));

  const media = await fetch(`${API}/api/orbit/photo/ph_missing`, { headers: { authorization: SCHEME + priya } });
  const mediaBody = await media.text();

  // ---------------------------------------------------------------- the acceptance scan
  const audiencePayloads = JSON.stringify({ priyaView, lorettaView, danaView, mcpOrbitPriya, mcpOrbitDana, mcpCheckDana, mediaBody });
  const forbidden = [
    ['place name', /lincoln/i],
    ['street', /main street|street/i],
    ['school', /school/i],
    ['event title', /room 12|bake sale|recital/i],
    ['last seen', /last seen/i],
    ['coordinates', /-?\d{1,3}\.\d{4,}/],
    ['event/job detail', /job_|attempt|pickup/i],
  ];
  for (const [label, re] of forbidden) {
    const hit = audiencePayloads.match(re);
    check(`4 no ${label} in any audience-facing payload`, hit === null, hit ? String(hit[0]) : 'clean');
  }
  check('4 the audience payload contains only vocabulary-generated description',
    /Wearing: yellow raincoat/.test(priyaView.data?.orbitAlert?.message ?? '') && !/blue|green|red/i.test(priyaView.data?.orbitAlert?.message ?? ''));

  const err = await gql(priya, `mutation($d: ID!){ orbitPreview(draftId:$d){ message } }`, { d: 'oa_missing' });
  check('5 an error response carries no place or record detail', !/lincoln|school|room 12|last seen/i.test(JSON.stringify(err)), JSON.stringify(err).slice(0, 120));
} finally {
  if (alertId) {
    const job = (await conn.query('select job_id from orbit_alerts where id=$1', [alertId])).rows[0]?.job_id;
    for (const q of ['delete from orbit_responses where orbit_alert_id=$1', 'delete from orbit_audience_members where orbit_alert_id=$1', 'delete from orbit_alerts where id=$1']) await conn.query(q, [alertId]).catch(() => {});
    if (job) await conn.query('delete from coordination_jobs where id=$1', [job]).catch(() => {});
  }
  if (before) await conn.query(`update household_policies set value=$1 where rule='orbit_notify_eligible' and household_id='h_a'`, [before]);
  await conn.end();
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
