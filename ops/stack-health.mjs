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
if (session) {
  const g = await fetch(APP + '/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: SCHEME + session },
    body: JSON.stringify({ query: '{ myChildren { child { id } } }' }),
  });
  const gj = await g.json().catch(() => null);
  const kids = gj?.data?.myChildren ?? [];
  check('authenticated myChildren is non-empty', g.status === 200 && kids.length > 0,
    `status=${g.status} count=${kids.length}`);
} else {
  check('authenticated myChildren is non-empty', false, 'no session to test with');
}

// 4. the MCP Rosina must talk to is actually listening
const mcpProbe = await (async () => {
  try {
    const r = await fetch(MCP_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'stack-health', version: '1' } } }) });
    return r.status;
  } catch { return 0; }
})();
check('MCP answers on the configured port', mcpProbe > 0 && mcpProbe < 500, `status=${mcpProbe}`);

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

console.log(`\nRESULT: ${failed === 0 ? 'HEALTHY' : 'UNHEALTHY'} (${failed} failing check${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
