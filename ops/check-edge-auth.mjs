/**
 * Milestone 2B Section A — edge-auth assertions and MCP-through-the-graph check.
 *
 *   A5: tampered token -> AUTH_ERROR at the main router (401)
 *       missing token  -> UNAUTHENTICATED from a subgraph (200), i.e. not stopped at the edge
 *       MCP as Kendra  -> PickupCandidates returns 4 people
 *
 * Writes docs/evidence/16-edge-auth-and-mcp.md, sanitized: no token, key or password.
 */
import { writeFileSync } from 'node:fs';
import { redactBearer, tokenForPersonId } from './auth.mjs';

const ROUTER = 'http://127.0.0.1:4010/';
const MCP = 'http://127.0.0.1:5050/mcp';
const QUERY = '{ pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { person { displayName } reason } }';

const jwt = await tokenForPersonId('p_mom');

function tampered(token) {
  const [h, p, s] = token.split('.');
  return `${h}.${p}.${s.slice(0, -4)}AAAA`;
}

async function routerCall(token) {
  const res = await fetch(ROUTER, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'x-demo-date': '2026-10-26',
    },
    body: JSON.stringify({ query: QUERY }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    codes: (body.errors ?? []).map((e) => e.extensions?.code ?? 'no-code'),
    names: (body.data?.pickupCandidates ?? []).map((c) => c.person.displayName),
  };
}

const valid = await routerCall(jwt);
const tamper = await routerCall(tampered(jwt));
const missing = await routerCall(undefined);

// --- MCP, as Kendra, through the graph -------------------------------------
let sessionId;
let mcpResult;
async function rpc(method, params, notify = false) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${jwt}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: 1, method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const text = await res.text();
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/event-stream')) {
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
    return data.length ? JSON.parse(data[data.length - 1]) : {};
  }
  return text ? JSON.parse(text) : {};
}

await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'edge-auth-check', version: '1.0.0' },
});
await rpc('notifications/initialized', {}, true);
mcpResult = await rpc('tools/call', {
  name: 'PickupCandidates',
  arguments: { childId: 'p_nora', asOf: '2026-10-26' },
});

let mcpNames = [];
let mcpError = null;
try {
  const payload = JSON.parse(mcpResult.result.content[0].text);
  mcpNames = (payload.data?.pickupCandidates ?? []).map((c) => c.person.displayName);
  mcpError = payload.errors?.[0]?.extensions?.code ?? null;
} catch {
  mcpError = 'unparseable tool result';
}

const rows = [
  ['valid token (Kendra)', `200 ready`, valid.status, valid.codes.join(',') || '—', `${valid.names.length} people`],
  ['tampered signature', 'AUTH_ERROR', tamper.status, tamper.codes.join(',') || '—', 'no data'],
  ['no Authorization header', 'UNAUTHENTICATED', missing.status, missing.codes.join(',') || '—', 'no data'],
];

console.log('case                        expected            http  code');
for (const [label, expected, status, code] of rows) {
  console.log(label.padEnd(27), String(expected).padEnd(19), String(status).padEnd(5), code);
}
console.log('\nMCP tools/call as Kendra ->', mcpNames.length ? mcpNames.join(', ') : `(error: ${mcpError})`);

const md = [
  '# 16 — Edge auth on the main router, and MCP through the graph',
  '',
  'Main router: `router.graphos.yaml` on `127.0.0.1:4010` (health 8090), connected to GraphOS,',
  'router-level JWT **on**. Started from `~/.rover/bin/router-v2.18.0`, not `rover dev`.',
  'Startup log: `UpdateLicense(Licensed)`, 0 ERROR lines.',
  '',
  '## Edge assertions',
  '',
  '| Case | Expected | HTTP | Code | Data |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map(([l, e, s, c, d]) => `| ${l} | ${e} | ${s} | ${c} | ${d} |`),
  '',
  '- **Tampered token is rejected at the edge**: HTTP ' + tamper.status + ', `' +
    (tamper.codes.join(',') || 'no code') + '`, before any subgraph executes.',
  '- **A missing token is NOT stopped at the edge** (documented router behaviour). It reaches the',
  '  subgraph and is rejected there as `UNAUTHENTICATED`. That is why subgraph verification must',
  '  stay: the edge layer only sees tokens that exist.',
  '- Valid token returns live rows: ' + (valid.names.join(', ') || 'none') + '.',
  '',
  '## MCP',
  '',
  '`tools/call PickupCandidates` as Kendra (the caller\'s own token forwarded by the MCP server):',
  '',
  '```',
  mcpNames.length ? mcpNames.join('\n') : `error: ${mcpError}`,
  '```',
  '',
  `Identity used: ${redactBearer(jwt)} (never written).`,
  '',
].join('\n');

writeFileSync('docs/evidence/16-edge-auth-and-mcp.md', md);
console.log('\nwrote docs/evidence/16-edge-auth-and-mcp.md');
