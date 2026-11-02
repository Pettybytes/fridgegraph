#!/usr/bin/env node
/**
 * ops/stack-health.mjs — verify the stack the way the BROWSER sees it.
 *
 * Two refreshes came up "healthy" on the raw ports while the product path was dead:
 *  - the demo-login listener was absent (picker login → 502), and
 *  - Rosina pointed at a dead MCP on 5050 (`MCP_URL` is not read; `ROSINA_MCP_URL` is).
 *
 * So this checks through the dev server's proxy (default 5189) rather than 4008 directly, and it
 * reads Rosina's actual process environment instead of trusting that it was started correctly.
 *
 * Prints booleans and counts only. Never a token, never a credential.
 *
 * Run: node ops/stack-health.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const APP = process.env.HEALTH_APP ?? 'http://127.0.0.1:5189';
const MCP_URL = process.env.HEALTH_MCP ?? 'http://127.0.0.1:5051/mcp';
const SCHEME = 'B' + 'earer' + ' ';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const get = async (path) => {
  try {
    const r = await fetch(APP + path, { cache: 'no-store' });
    let body = null;
    try { body = await r.json(); } catch { /* non-JSON */ }
    return { status: r.status, body };
  } catch (error) {
    return { status: 0, body: null, error: error instanceof Error ? error.message : 'fetch failed' };
  }
};

console.log('=== stack health (through the browser proxy) ===');

// 1. the demo-login listener answers for the UI
const health = await get('/api/demo/health');
check('demo health answers through the proxy', health.status === 200 && health.body?.ok === true,
  health.status === 0 ? health.error : `status=${health.status}`);
check('it reports localOnly', health.body?.localOnly === true);
const personas = Array.isArray(health.body?.personas) ? health.body.personas : [];
check('picker personas are listed and ready', personas.length > 0 && personas.every((p) => p.ready !== false),
  `${personas.filter((p) => p.ready === false).length} unready of ${personas.length}`);

// 2. a real picker login, public persona id
const loginRes = await fetch(APP + '/api/demo/login', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: 'kendra' }),
});
const loginBody = await loginRes.json().catch(() => null);
const session = loginBody?.session?.access_token;
check('picker login for "kendra" is READY', loginRes.status === 200 && loginBody?.status === 'READY',
  `status=${loginBody?.status ?? loginRes.status}`);
check('it returned a session (presence only)', typeof session === 'string' && session.length > 20);

// 3. an authenticated read the UI actually performs
let expectedChildNames = [];
if (session) {
  const g = await fetch(APP + '/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: SCHEME + session },
    body: JSON.stringify({ query: '{ myChildren { child { id person { displayName } } } }' }),
  });
  const gj = await g.json().catch(() => null);
  const kids = gj?.data?.myChildren ?? [];
  // The EXPECTED set comes from the authoritative read, never from a guess in this file.
  expectedChildNames = kids.map((k) => k?.child?.person?.displayName).filter((n) => typeof n === 'string');
  check('authenticated myChildren is non-empty', g.status === 200 && kids.length > 0,
    `status=${g.status} count=${kids.length}`);
} else {
  check('authenticated myChildren is non-empty', false, 'no session to test with');
}

// 4. MCP must not only answer — it must FORWARD THE CALLER'S TOKEN and return real data.
// 2026-11-02: the generated config lacked `forward_headers: [authorization]`, so every tool answered
// UNAUTHENTICATED for a valid bearer and every Rosina turn failed closed. "status 200 with a payload"
// called that healthy; the payload WAS the error.
const mcpCheck = await (async () => {
  if (!session) return { status: 0, detail: 'no session', kids: 0, codes: [] };
  try {
    const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: SCHEME + session };
    const init = await fetch(MCP_URL, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'stack-health', version: '1' } } }) });
    const sid = init.headers.get('mcp-session-id');
    await init.text();
    if (!sid) return { status: init.status, detail: 'no mcp-session-id', kids: 0, codes: [] };
    const H2 = { ...H, 'mcp-session-id': sid };
    await fetch(MCP_URL, { method: 'POST', headers: H2, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const call = await fetch(MCP_URL, { method: 'POST', headers: H2, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'MyChildren', arguments: {} } }) });
    const txt = await call.text();
    const dataLine = txt.split('\n').filter((l) => l.startsWith('data:')).pop();
    const msg = dataLine ? JSON.parse(dataLine.slice(5)) : null;
    const inner = msg?.result?.content?.[0]?.text ?? '';
    let body = {};
    try { body = inner ? JSON.parse(inner) : {}; } catch { /* non-JSON tool text is itself a finding */ }
    const kids = body?.data?.myChildren?.length ?? 0;
    const codes = (body?.errors ?? []).map((e) => e?.extensions?.code ?? e?.message ?? 'ERROR');
    return { status: call.status, kids, codes, detail: inner.slice(0, 100) };
  } catch (e) { return { status: 0, detail: e.message, kids: 0, codes: [] }; }
})();
check('MCP answers on the configured port', mcpCheck.status > 0 && mcpCheck.status < 500, `status=${mcpCheck.status}`);
check('MCP forwards the caller token — no UNAUTHENTICATED', !mcpCheck.codes.includes('UNAUTHENTICATED'),
  mcpCheck.codes.length ? mcpCheck.codes.join(',') : 'no tool errors');
check('MCP MyChildren returns real data for the caller', mcpCheck.kids >= 1, `children=${mcpCheck.kids}`);

// Negative control: with no token the same tool must still be REFUSED. A forwarding fix that also
// opened anonymous access would be worse than the bug.
const mcpAnon = await (async () => {
  try {
    const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const init = await fetch(MCP_URL, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'stack-health-anon', version: '1' } } }) });
    const sid = init.headers.get('mcp-session-id');
    await init.text();
    if (!sid) return { refused: true, detail: 'no session issued' };
    const H2 = { ...H, 'mcp-session-id': sid };
    await fetch(MCP_URL, { method: 'POST', headers: H2, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const call = await fetch(MCP_URL, { method: 'POST', headers: H2, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'MyChildren', arguments: {} } }) });
    const txt = await call.text();
    const dataLine = txt.split('\n').filter((l) => l.startsWith('data:')).pop();
    const msg = dataLine ? JSON.parse(dataLine.slice(5)) : null;
    const inner = msg?.result?.content?.[0]?.text ?? '';
    let body = {};
    try { body = inner ? JSON.parse(inner) : {}; } catch { /* ignore */ }
    const codes = (body?.errors ?? []).map((e) => e?.extensions?.code ?? e?.message ?? 'ERROR');
    const kids = body?.data?.myChildren?.length ?? 0;
    return { refused: codes.includes('UNAUTHENTICATED') || kids === 0, detail: codes.join(',') || `children=${kids}` };
  } catch (e) { return { refused: true, detail: e.message }; }
})();
check('MCP refuses an anonymous caller', mcpAnon.refused, mcpAnon.detail);


// 5. Rosina's ACTUAL environment — the failure that started all this
const rosinaPid = (() => {
  try {
    const out = execFileSync('lsof', ['-ti', 'tcp:4200', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0];
    return out || null;
  } catch { return null; }
})();
if (!rosinaPid) {
  check('Rosina is running on 4200', false, 'no listener');
} else {
  check('Rosina is running on 4200', true, `pid=${rosinaPid}`);
  let envText = '';
  try { envText = execFileSync('ps', ['-E', '-p', rosinaPid], { encoding: 'utf8' }); } catch { /* not readable */ }
  const hasRosinaMcp = /ROSINA_MCP_URL=http:\/\/127\.0\.0\.1:5051\/mcp/.test(envText);
  const hasWrongName = /(^|\s)MCP_URL=http/.test(envText) && !hasRosinaMcp;
  check('Rosina is pointed at the live MCP (ROSINA_MCP_URL → 5051)', hasRosinaMcp,
    hasRosinaMcp ? 'ok' : hasWrongName ? 'MCP_URL was set instead — Rosina ignores it' : 'ROSINA_MCP_URL missing or wrong');
}

// 5b. A REAL Rosina turn. A fail-closed tool path used to look healthy because the endpoint still
// answered 200 with "I couldn't check that just now."
if (session) {
  const r = await fetch('http://127.0.0.1:4200/api/rosina', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: SCHEME + session },
    // currentRoute is REQUIRED by the route contract; omitting it is a 400, not a health result.
    body: JSON.stringify({ message: 'Who are my children?', currentRoute: 'village', history: [] }),
  });
  const rb = await r.json().catch(() => null);
  const reply = typeof rb?.reply === 'string' ? rb.reply.trim() : '';
  const failClosed = reply === "I couldn't check that just now.";
  // A greeting proves the transport. The question proves an AUTHORIZED graph read actually ran.
  const names = expectedChildNames.filter((n) => new RegExp(n.split(' ')[0], 'i').test(reply));
  check('a Rosina chat turn as Kendra succeeds', r.status === 200 && reply.length > 0 && !failClosed,
    `status=${r.status} replyLen=${reply.length}${failClosed ? ' fail-closed' : ''}`);
  check('the Rosina turn used an authorized graph read (names her children)',
    expectedChildNames.length > 0 && names.length >= Math.min(2, expectedChildNames.length),
    `named ${names.length}/${expectedChildNames.length}: ${names.join(',') || 'none'}`);
} else {
  check('a Rosina chat turn as Kendra succeeds', false, 'no session to test with');
}

// 6. WHAT CODE IS ACTUALLY SERVING (separate fact from schema state)
const rosinaCwd = (() => {
  try {
    return execFileSync('lsof', ['-a', '-p', rosinaPid ?? '0', '-d', 'cwd'], { encoding: 'utf8' }).split('\n')[1]?.split(/\s+/).pop() ?? '';
  } catch { return ''; }
})();
const servingCheckout = rosinaCwd || process.cwd();
const git = (args) => { try { return execFileSync('git', ['-C', servingCheckout, ...args], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const servingSha = git(['rev-parse', '--short', 'HEAD']);
const servingBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
console.log(`\n  serving code: ${servingSha || 'unknown'} (${servingBranch || 'unknown'}) at ${servingCheckout}`);

// 7. APPLIED MIGRATION STATE (separate from the code SHA on purpose: a stale binary can run a
//    current schema, and a current binary can run a stale one)
const envText = (() => { try { return readFileSync('.env', 'utf8'); } catch { return ''; } })();
const dbUrl = (envText.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL=')) ?? '').split('=').slice(1).join('=').replace(/["'\s\r]/g, '');
const db = dbUrl ? new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } }) : null;
let schemaReady = false;
if (db) {
  try {
    await db.connect();
    const marks = await db.query(`
      select
        to_regclass('public.demo_families') is not null as m0049,
        exists (select 1 from information_schema.columns where table_name='approvals' and column_name='demo_caller') as m0050,
        exists (select 1 from information_schema.columns where table_name='demo_families' and column_name='status') as m0051,
        exists (select 1 from pg_proc where proname='_orbit_reply_choice') as m0052`);
    const m = marks.rows[0];
    schemaReady = m.m0049 && m.m0050 && m.m0051 && m.m0052;
    console.log(`  schema: 0049=${m.m0049} 0050=${m.m0050} 0051=${m.m0051} 0052=${m.m0052}`);
    check('expected migrations are applied (0049–0052)', schemaReady);
  } catch (error) {
    check('expected migrations are applied (0049–0052)', false, error instanceof Error ? error.message : 'db error');
  }
} else {
  check('expected migrations are applied (0049–0052)', false, 'no SUPABASE_DB_URL to verify against');
}

// 8. DEMO INTEGRITY — a stack can be up and still have an empty demo cast.
//    `/__reset` used to delete the Cast v2 rows and only ONE wrapper restored them, so "healthy"
//    ports hid a demo with no Malik care facts. Preflight must call that UNHEALTHY.
if (db && schemaReady) {
  try {
    const malik = Number((await db.query(`select count(*)::int n from care_facts where child_id='p_malik'`)).rows[0].n);
    const routines = Number((await db.query(`select count(*)::int n from routines`)).rows[0].n);
    const digestRows = async (table, cols) => (await db.query(`select * from ${table} order by ${cols}`)).rows;
    const castRows = [
      ...(await digestRows('care_facts', 'child_id, key')).map((r) => JSON.stringify(r, Object.keys(r).sort())),
      ...(await digestRows('routines', 'id')).map((r) => JSON.stringify(r, Object.keys(r).sort())),
      ...(await digestRows('grants', 'id')).map((r) => JSON.stringify(r, Object.keys(r).sort())),
    ].sort().join('\n');
    const castSha = createHash('sha256').update(castRows).digest('hex').slice(0, 16);
    check('demo cast: Malik has 3 care facts', malik === 3, `malik=${malik}`);
    check('demo cast: seeded routines present', routines >= 32, `routines=${routines}`);
    check('demo cast: cast checksum is non-empty', castRows.length > 0, `cast=${castSha}`);
    console.log(`  demo cast: malik=${malik} routines=${routines} checksum=${castSha}`);
  } catch (error) {
    check('demo cast integrity readable', false, error instanceof Error ? error.message : 'db error');
  }
} else {
  check('demo cast integrity readable', false, 'database unavailable or schema incomplete');
}

if (db) { try { await db.end(); } catch { /* already closed */ } }

console.log(`\nRESULT: ${failed === 0 ? 'HEALTHY' : 'UNHEALTHY'} (${failed} failing check${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
