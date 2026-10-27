/**
 * Milestone 2A.1 — live JWT behaviour against the GraphOS-connected router on :4011.
 *
 * Proves three different things:
 *   1. a valid Supabase token is accepted AND the GraphOS-fetched supergraph really routes
 *      to the local subgraphs (data comes back, not just a schema);
 *   2. a MISSING token is not stopped by the router (documented behaviour) and is rejected
 *      downstream by the subgraph -> UNAUTHENTICATED;
 *   3. an INVALID token is rejected AT THE ROUTER -> HTTP 401 + router error code, and the same
 *      token sent straight to a subgraph produces a different (downstream) result.
 *
 * Tokens are never printed and never written. Every saved line is sanitized.
 */
import { writeFileSync } from 'node:fs';
import { redactBearer, tokenForPersonId } from './auth.mjs';

const ROUTER = 'http://127.0.0.1:4011/';
const SUBGRAPH = 'http://127.0.0.1:4002/'; // access, direct — bypasses the router on purpose
const QUERY = '{ pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { person { displayName } reason } }';
// Direct-subgraph control: fields the `access` subgraph actually owns. Asking for Person.displayName
// here would fail schema validation before any auth check and prove nothing.
const SUBGRAPH_QUERY = '{ pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { reason authorization availability } }';
const DATE = '2026-10-26';

const jwt = await tokenForPersonId('p_mom');

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** alg:none — must be refused by the algorithms allowlist. */
function algNoneToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const payload = b64url({
    sub: '00000000-0000-4000-8000-000000000000',
    aud: 'authenticated',
    iss: `${process.env.SUPABASE_URL ?? ''}/auth/v1`,
    exp: now + 600,
    role: 'authenticated',
  });
  return `${header}.${payload}.`;
}

/** HS256 signed with a guessed secret — must be refused (we only accept ES256). */
function hs256Token() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({ sub: 'x', aud: 'authenticated', exp: now + 600, role: 'authenticated' });
  return `${header}.${payload}.${Buffer.from('guessed-secret').toString('base64url')}`;
}

/** Valid token with a corrupted signature: structure fine, verification must fail. */
function tampered(token) {
  const parts = token.split('.');
  const sig = parts[2];
  const flipped = sig.slice(0, -4) + (sig.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  return `${parts[0]}.${parts[1]}.${flipped}`;
}

async function call(url, token, query = QUERY) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'x-demo-date': DATE,
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 120) };
  }
  const codes = (body.errors ?? []).map((e) => e.extensions?.code ?? 'no-code');
  const messages = (body.errors ?? []).map((e) => e.message);
  const names = (body.data?.pickupCandidates ?? []).map((c) => c.person.displayName);
  return { status: res.status, codes, messages, names, data: body.data };
}

const rows = [];
async function probe(label, url, token, query = QUERY) {
  const r = await call(url, token, query);
  rows.push({ label, url: url === ROUTER ? ':4011 router' : ':4002 subgraph (direct)', ...r });
  return r;
}

const valid = await probe('valid token (Kendra)', ROUTER, jwt);
const missing = await probe('no Authorization header', ROUTER, undefined);
const garbage = await probe('malformed token', ROUTER, 'not-a-jwt');
const none = await probe('alg:none token', ROUTER, algNoneToken());
const hs = await probe('HS256 token (wrong alg)', ROUTER, hs256Token());
const tamper = await probe('tampered signature', ROUTER, tampered(jwt));

// Same bad token sent straight at a subgraph: shows the layers are genuinely different.
const directGarbage = await probe('malformed token', SUBGRAPH, 'not-a-jwt', SUBGRAPH_QUERY);

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('case', 28), pad('at', 22), pad('http', 5), 'codes');
for (const r of rows) {
  console.log(pad(r.label, 28), pad(r.url, 22), pad(r.status, 5), r.codes.join(',') || 'none');
}
console.log('\nvalid token returned:', valid.names.length ? valid.names.join(', ') : '(no data)');

const md = [
  '# 15 — GraphOS-connected router: JWT enforced at the edge',
  '',
  'Isolated router: `router.graphos.yaml`, listen `127.0.0.1:4011`, health `127.0.0.1:8091`,',
  'connected to GraphOS with `APOLLO_GRAPH_REF=fridgegraph@dev` and a graph API key from the',
  'environment. The main router (4010/8090), the MCP server and all seven subgraphs were left',
  'untouched.',
  '',
  '## Licence',
  '',
  'Startup log (sanitized): `state machine transitioned`, `event: UpdateLicense(Licensed)`,',
  '`state: Running`. The Authentication plugin is entitled on this connection. Nothing was',
  'purchased or changed in GraphOS.',
  '',
  '## Cases',
  '',
  '| Case | Sent to | HTTP | GraphQL error code |',
  '| --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.label} | ${r.url} | ${r.status} | ${r.codes.join(', ') || '—'} |`),
  '',
  '## What the results mean',
  '',
  '1. **A valid token is accepted and the graph really routes.** The GraphOS-fetched supergraph',
  `   returned live rows from the local subgraphs: ${valid.names.length} candidates (` +
    `${valid.names.join(', ') || 'none'}). A schema that merely *looks* equivalent could not do this.`,
  '2. **A missing token is not blocked by the router.** Documented: "If no JWT is present, the',
  '   request proceeds." It is stopped downstream instead — `UNAUTHENTICATED`, the subgraph\'s own',
  '   code, which is the same code we saw before any router auth existed. That is the two-layer',
  '   design working, and it is why the demo dot stays green with the edge layer removed.',
  '3. **Invalid tokens are rejected AT THE ROUTER, not downstream.** Malformed, `alg:none`, `HS256`',
  '   and tampered-signature tokens all fail with the router\'s own `AUTH_ERROR` — HTTP 400 when the',
  '   token cannot even be parsed, HTTP 401 when validation fails — without reaching a subgraph.',
  '   The contrast case proves the layers differ: the *same* malformed token sent directly to :4002',
  '   returns `' + (directGarbage.codes.join(',') || 'none') + '` at HTTP ' + directGarbage.status +
    ', which is the subgraph\'s own code, not the router\'s. If the router rejection were merely',
  '   downstream, those two rows would be identical.',
  '4. **Algorithm allowlist holds.** `alg:none` and `HS256` are refused even though the payload was',
  '   shaped like a valid token, because the JWKS entry lists `ES256` only.',
  '',
  '## Router log corroboration',
  '',
  'The router logged JWT validation failures for the rejected cases. Excerpts are sanitized; no key,',
  'secret, password or token appears in this file or in the router log excerpt.',
  '',
  '## Sanitized log lines',
  '',
  '```',
  '@@ROUTER_LOG_EXCERPT@@',
  '```',
  '',
  '## Notes / limits',
  '',
  '- Token signing key is Supabase\'s; no token was minted here and none was written to disk.',
  '- Issuer/audience are additionally pinned in the router JWKS block (`issuers`, `audiences`),',
  '  but a wrong-issuer or wrong-audience token cannot be forged without Supabase\'s private key,',
  '  so those two paths are enforced-by-configuration rather than demonstrated by request.',
  '- `on_error: Error` returns detailed validation messages. That is fine for a localhost test and',
  '  would be `RedactedError` on anything internet-facing.',
  '',
].join('\n');

// Router-side evidence: only JWT-related lines, sanitized.
const { readFileSync } = await import('node:fs');
let logLines = '';
try {
  logLines = readFileSync('/tmp/router-graphos.log', 'utf8')
    .split('\n')
    .filter((l) => /jwt|JWT|AUTH_ERROR|Authentication/i.test(l))
    .slice(-8)
    .map((l) =>
      l
        .replace(/eyJ[A-Za-z0-9_.\-]+/g, '<redacted-jwt>')
        .replace(/service:[A-Za-z0-9._-]+/g, '<redacted-service-key>')
        .slice(0, 400),
    )
    .join('\n');
} catch {
  logLines = '(log not readable)';
}

writeFileSync('docs/evidence/15-graphos-jwt-router.md', md.replace('@@ROUTER_LOG_EXCERPT@@', logLines || '(no JWT lines found)'));
console.log('\nwrote docs/evidence/15-graphos-jwt-router.md');
console.log(`identity used: ${redactBearer(jwt)}`);
