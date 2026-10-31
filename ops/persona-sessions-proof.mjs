#!/usr/bin/env node
/**
 * ops/persona-sessions-proof.mjs — proofs a-e for the shared persona session cache.
 *
 * Run with tsx so the REAL cache, mint and verifier are exercised, not a reimplementation:
 *   npx tsx ops/persona-sessions-proof.mjs
 *
 * a) 30 concurrent cache-layer requests for one persona -> exactly ONE mint, one identical personId
 * b) the endpoint's configured limits (60/min IP, 8/min persona) hold; 429 is retryable, and only
 *    one mint occurs across the whole run
 * c) two personas never share a session (different tokens, different verified identities)
 * d) inside the safety window: exactly one server-side refresh, new REAL expires_at; outside it:
 *    the cached token, no mint and no refresh
 * e) switching personas in one browser never changes another browser's identity or revokes anything
 *
 * Tokens, refresh tokens and links stay in memory. Nothing secret is printed or written.
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env', 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
process.env.IDENTITY_MAP_PATH ??= new URL('../data/identity-map.json', import.meta.url).pathname;

const { verifyBearer } = await import('../src/auth/verify.ts');
const { personaById } = await import('../src/demo/personas.ts');
const sessions = await import('../src/demo/persona-sessions.ts');
const { createDemoLoginApp } = await import('../src/demo/server.ts');

const {
  getPersonaSession,
  publicPersonaSession,
  dropPersonaSessionCache,
  personaSessionStats,
  RENEWAL_SAFETY_WINDOW_MS,
  __setPersonaSessionClock,
  __resetPersonaSessionClock,
  __cachedAccessToken,
  __setSessionGate,
} = sessions;

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
};

const persona = (id) => {
  const p = personaById(id);
  if (!p) throw new Error(`unknown persona in proof: ${id}`);
  return p;
};

const identityOf = async (token) => {
  const result = await verifyBearer(`Bearer ${token}`);
  return result.ok ? result.personId : `ERR:${result.reason}`;
};

const kendra = persona('kendra');
const andre = persona('andre');
const dana = persona('dana');

console.log('=== persona sessions proof ===');

// ---------------------------------------------------------------- a) single-flight mint
dropPersonaSessionCache();
const burst = await Promise.all(Array.from({ length: 30 }, () => getPersonaSession(kendra)));
const first = burst[0].session;
check('a1 30 concurrent cache calls mint exactly once', personaSessionStats().mints === 1,
  `mints=${personaSessionStats().mints}`);
check('a2 every caller received the same session', burst.every((r) => r.session.access_token === first.access_token));
const statsA = personaSessionStats();
check('a3 the other 29 callers joined the one operation (no extra mint, no extra entry)',
  statsA.mints === 1 && statsA.cacheHits === 0 && statsA.inflightJoins === 29,
  `mints=${statsA.mints} hits=${statsA.cacheHits} joins=${statsA.inflightJoins}`);
check('a4 the shared token resolves to Kendra', (await identityOf(first.access_token)) === 'p_mom');

// ---------------------------------------------------------------- c) personas never share
const [k2, a2] = await Promise.all([getPersonaSession(kendra), getPersonaSession(andre)]);
const [kIdent, aIdent] = await Promise.all([identityOf(k2.session.access_token), identityOf(a2.session.access_token)]);
check('c1 Kendra and Andre get different access tokens', k2.session.access_token !== a2.session.access_token);
check('c2 each token resolves to its own identity', kIdent === 'p_mom' && aIdent === 'p_dad', `${kIdent} / ${aIdent}`);
check('c3 the cache holds them under separate keys, and no mint happened for the warm persona',
  __cachedAccessToken('kendra') === k2.session.access_token &&
  __cachedAccessToken('andre') === a2.session.access_token &&
  personaSessionStats().mints === 2, `mints=${personaSessionStats().mints}`);

// ---------------------------------------------------------------- d) renewal safety window
dropPersonaSessionCache();
const realNow = Date.now();
let fakeNow = realNow;
__setPersonaSessionClock(() => fakeNow);

const d0 = await getPersonaSession(kendra);
const originalExpiry = d0.session.expires_at;
check('d1 first request mints and reports the real expiry', personaSessionStats().mints === 1 &&
  originalExpiry * 1000 - realNow > RENEWAL_SAFETY_WINDOW_MS, `expires in ${Math.round((originalExpiry * 1000 - realNow) / 60000)}m`);

// Outside the window (10 minutes before expiry, window is 5): cached token, no mint, no refresh.
fakeNow = originalExpiry * 1000 - 10 * 60 * 1000;
const d1 = await getPersonaSession(kendra);
check('d2 outside the window: same token, no mint, no refresh', d1.source === 'cache' &&
  d1.session.access_token === d0.session.access_token &&
  personaSessionStats().mints === 1 && personaSessionStats().refreshes === 0,
  `source=${d1.source} mints=${personaSessionStats().mints} refreshes=${personaSessionStats().refreshes}`);

// Inside the window: exactly one refresh, new real expiry.
fakeNow = originalExpiry * 1000 - 2 * 60 * 1000;
const d2 = await getPersonaSession(kendra);
check('d3 inside the window: one server-side refresh', d2.source === 'renewed' && personaSessionStats().refreshes === 1,
  `source=${d2.source} refreshes=${personaSessionStats().refreshes}`);
// The refresh returns the NEW, real expiry from Supabase. Seconds after a mint that is only a few
// seconds later (and can land in the same second), so the invariant is a fresh token plus a real
// expiry that is never earlier and never invented.
check('d4 the refresh returned a new token and a real, non-regressing expiry',
  d2.session.access_token !== d0.session.access_token && d2.session.expires_at >= originalExpiry,
  `${originalExpiry} -> ${d2.session.expires_at}`);
check('d5 the reported expiry is the session\u2019s actual expiry (not invented)',
  publicPersonaSession(d2.session).expires_at === d2.session.expires_at);

// Concurrent renewals inside the window share ONE refresh.
fakeNow = d2.session.expires_at * 1000 - 60 * 1000;
const renewals = await Promise.all(Array.from({ length: 10 }, () => getPersonaSession(kendra)));
check('d6 10 simultaneous renewals share exactly one refresh', personaSessionStats().refreshes === 2,
  `refreshes=${personaSessionStats().refreshes}`);
check('d7 all renewals returned the same renewed token', renewals.every((r) => r.session.access_token === renewals[0].session.access_token));

__resetPersonaSessionClock();

// ---------------------------------------------------------------- e) browser-local selection
dropPersonaSessionCache();
const e0 = await getPersonaSession(kendra);
const e1 = await getPersonaSession(dana);
const kendraBefore = __cachedAccessToken('kendra');
// Browser B switches to Kendra, then back to Dana; browser A's Kendra session must be untouched.
await getPersonaSession(kendra);
await getPersonaSession(dana);
check('e1 switching personas never replaces another persona\u2019s session',
  __cachedAccessToken('kendra') === kendraBefore && kendraBefore === e0.session.access_token);
check('e2 both identities still resolve after the switch',
  (await identityOf(__cachedAccessToken('kendra'))) === 'p_mom' &&
  (await identityOf(__cachedAccessToken('dana'))) === 'p_dana');
check('e3 switching minted nothing new for warm personas', personaSessionStats().mints === 2 &&
  personaSessionStats().refreshes === 0, `mints=${personaSessionStats().mints}`);

// ---------------------------------------------------------------- b) endpoint limits
// A fresh app instance so the in-memory windows start empty; the cache is dropped so the run proves
// one mint across every permitted request.
dropPersonaSessionCache();
const app = createDemoLoginApp();
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const loginOnce = async (personaId) => {
  const res = await fetch(`${base}/api/demo/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId }),
  });
  return { http: res.status, retryAfter: res.headers.get('retry-after'), body: await res.json() };
};

const permitted = [];
for (let i = 0; i < 8; i += 1) permitted.push(await loginOnce('kendra'));
check('b1 the 8 permitted per-persona requests all succeed', permitted.every((r) => r.http === 200 && r.body.status === 'READY'));
check('b2 the endpoint never emits a refresh token', permitted.every((r) => !('refresh_token' in r.body.session)));
check('b3 all permitted requests share ONE minted token',
  new Set(permitted.map((r) => r.body.session.access_token)).size === 1 &&
  personaSessionStats().mints === 1, `mints=${personaSessionStats().mints}`);
check('b4 every response carries the real expires_at', permitted.every((r) => typeof r.body.session.expires_at === 'number' && r.body.session.expires_at > Math.floor(Date.now() / 1000)));

const overPersona = await loginOnce('kendra');
check('b5 the 9th per-persona request is a retryable 429', overPersona.http === 429 &&
  overPersona.body.error === 'RATE_LIMITED' && Number(overPersona.retryAfter) > 0,
  `retry-after=${overPersona.retryAfter}`);

// Fill the per-IP window to exactly 60 using distinct unknown ids (each stays under its own limit).
// Unknown ids answer UNAVAILABLE, never a session, and never a mint.
const fillerIds = ['nobody-1', 'nobody-2', 'nobody-3', 'nobody-4', 'nobody-5', 'nobody-6', 'nobody-7'];
const filler = [];
for (let i = 0; i < 51; i += 1) filler.push(await loginOnce(fillerIds[i % fillerIds.length]));
check('b6 the per-IP window admits every request below 60', filler.every((r) => r.http === 200 && r.body.status === 'UNAVAILABLE'),
  `codes=${[...new Set(filler.map((r) => r.http))].join(',')}`);
check('b7 unknown personas never receive a session', filler.every((r) => !r.body.session));

const overIp = await loginOnce('kendra');
check('b8 the 61st request from one IP is a retryable 429', overIp.http === 429 &&
  overIp.body.error === 'RATE_LIMITED' && Number(overIp.retryAfter) > 0,
  `retry-after=${overIp.retryAfter}`);
check('b9 only one mint occurred across the whole endpoint run', personaSessionStats().mints === 1,
  `mints=${personaSessionStats().mints}`);

await new Promise((resolve) => server.close(resolve));
dropPersonaSessionCache();

// ---------------------------------------------------------------- f) reset during a mint
// Held mid-flight with the test-only gate, so no timing race decides the result.
dropPersonaSessionCache();
let releaseMint;
let mintReached;
const mintArrived = new Promise((resolve) => { mintReached = resolve; });
const mintHold = new Promise((resolve) => { releaseMint = resolve; });
let staleMintToken;
__setSessionGate(async (kind, _id, token) => { if (kind === 'mint') { staleMintToken = token; mintReached(); await mintHold; } });

const pendingMint = getPersonaSession(kendra);
await mintArrived;
dropPersonaSessionCache();            // the reset lands while the mint is in flight
releaseMint();
const afterMint = await pendingMint;
__setSessionGate(null);

// dropPersonaSessionCache() also zeroes the counters, so post-drop values are the whole story:
// exactly one discarded stale mint, then exactly one fresh mint.
const mintStats = personaSessionStats();
check('f1 the session minted before the drop was discarded, not cached as-is',
  mintStats.staleDiscards === 1, `staleDiscards=${mintStats.staleDiscards}`);
// Supabase can return byte-identical access tokens for the same user minted in the same second, so
// token inequality is not a freshness signal. The counters are: exactly one stale result discarded,
// exactly one fresh mint after the drop, and the served entry is the cached one.
check('f2 the caller was served by a FRESH mint after the drop, and it is the cached entry',
  mintStats.mints === 1 &&
  staleMintToken !== undefined &&
  __cachedAccessToken('kendra') === afterMint.session.access_token,
  `mints=${mintStats.mints} staleDiscards=${mintStats.staleDiscards}`);
check('f3 the cached token resolves to the persona', (await identityOf(__cachedAccessToken('kendra'))) === 'p_mom');
const mintWarm = await getPersonaSession(kendra);
check('f4 the next request is a cache hit on the fresh entry', mintWarm.source === 'cache' && mintWarm.session.access_token === afterMint.session.access_token);

// ---------------------------------------------------------------- g) reset during a refresh
dropPersonaSessionCache();
let fake2 = Date.now();
__setPersonaSessionClock(() => fake2);
const g0 = await getPersonaSession(kendra);
fake2 = g0.session.expires_at * 1000 - 60 * 1000;   // inside the renewal safety window

let releaseRefresh;
let refreshReached;
const refreshArrived = new Promise((resolve) => { refreshReached = resolve; });
const refreshHold = new Promise((resolve) => { releaseRefresh = resolve; });
__setSessionGate(async (kind) => { if (kind === 'refresh') { refreshReached(); await refreshHold; } });

const pendingRefresh = getPersonaSession(kendra);
await refreshArrived;
dropPersonaSessionCache();
releaseRefresh();
const afterRefresh = await pendingRefresh;
__setSessionGate(null);
__resetPersonaSessionClock();

const refreshStats = personaSessionStats();
check('g1 the refreshed session from before the drop was discarded',
  refreshStats.staleDiscards === 1, `staleDiscards=${refreshStats.staleDiscards}`);
check('g2 the caller was served a fresh mint after the drop, and it is cached',
  refreshStats.mints === 1 && __cachedAccessToken('kendra') === afterRefresh.session.access_token,
  `mints=${refreshStats.mints}`);
check('g3 the token still resolves to Kendra', (await identityOf(__cachedAccessToken('kendra'))) === 'p_mom');

// ---------------------------------------------------------------- h) reset during a created family's first login
// The case #54 exists for: the persona is DELETED by the reset while its mint is in flight.
const { createDemoFamily, familyPersona } = await import('../src/demo/family.ts');
const { resetDemo } = await import('../src/demo/reset.ts');

dropPersonaSessionCache();
const family = await createDemoFamily({ parentName: 'Race Parent', childName: 'Race Child' });
const familyP = await familyPersona(family.id);
check('h1 created family is pickable', familyP !== null && familyP.personId.startsWith('p_family_'));

// A real token for this persona, minted BEFORE the reset: this is the "old token" the reset must
// make worthless. It is held in memory only.
const firstFamilySession = await getPersonaSession(familyP);
const oldFamilyToken = firstFamilySession.session.access_token;
check('h2 the created persona can sign in before the reset', (await identityOf(oldFamilyToken)) === familyP.personId);

dropPersonaSessionCache();
let releaseFamily;
let familyReached;
const familyArrived = new Promise((resolve) => { familyReached = resolve; });
const familyHold = new Promise((resolve) => { releaseFamily = resolve; });
__setSessionGate(async (kind) => { if (kind === 'mint') { familyReached(); await familyHold; } });

const pendingFamily = getPersonaSession(familyP).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
await familyArrived;
const resetReport = await resetDemo('proof-session-race');   // deletes the persona and drops the cache
releaseFamily();
const familyOutcome = await pendingFamily;
__setSessionGate(null);

check('h3 reset removed the created family', resetReport.createdFamiliesRemoved >= 1);
check('h4 no session is served for the deleted persona', familyOutcome.ok === false,
  familyOutcome.ok ? 'a session was served' : String(familyOutcome.e?.code ?? familyOutcome.e?.message ?? 'error'));
check('h5 nothing is cached for the deleted persona', __cachedAccessToken(family.id) === undefined);
check('h6 the stale mint was discarded', personaSessionStats().staleDiscards >= 1,
  `staleDiscards=${personaSessionStats().staleDiscards}`);
check('h7 the deleted persona no longer resolves as a picker entry', (await familyPersona(family.id)) === null);
check('h8 the old token for the deleted persona is UNAUTHENTICATED',
  (await identityOf(oldFamilyToken)) === 'ERR:unmapped', await identityOf(oldFamilyToken));

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
