#!/usr/bin/env node
/**
 * ops/e2a-proof.mjs — E2a proofs (a-e) for the demo login endpoint.
 *
 * Run with tsx so the REAL server verifier is imported, not a reimplementation:
 *   npx tsx ops/e2a-proof.mjs
 *
 * a) an allow-listed persona signs in through the endpoint; Supabase issues the session; the
 *    existing verifyBearer() resolves the correct personId
 * b) the trusted demo marker is present in the verified token (and the guide's is guide-only)
 * c) two personas logging in in parallel each get only their own identity
 * d) unknown and unready personas return UNAVAILABLE (and never another identity)
 * e) a live GraphQL read as that persona returns their scoped data through the existing
 *    authorization path — and an unrelated adult gets nothing
 *
 * Tokens, refresh tokens and links stay in memory. Nothing secret is printed or written.
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v
process.env.IDENTITY_MAP_PATH ??= new URL('../data/identity-map.json', import.meta.url).pathname

const { verifyBearer } = await import('../src/auth/verify.ts')

const LOGIN = process.env.DEMO_LOGIN_URL ?? 'http://127.0.0.1:4008/api/demo/login'
const ROUTER = process.env.FRIDGEGRAPH_ROUTER ?? 'http://127.0.0.1:4010/'

let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`)
}

/** One attempt, no waiting. Used by the limiter case, which must SEE the 429. */
const loginOnce = async (personaId) => {
  const res = await fetch(LOGIN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId }),
  })
  return {
    http: res.status,
    retryAfter: res.headers.get('retry-after'),
    body: await res.json(),
  }
}

/**
 * Default login: waits out a 429 instead of failing. A proof run must not be broken by the windows a
 * previous run consumed, and the limiter is proven separately by loginOnce above.
 */
const login = async (personaId) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const r = await loginOnce(personaId)
    if (r.http !== 429) return r
    const wait = Number(r.retryAfter ?? 10)
    console.log(`  (rate limited; waiting ${wait}s)`)
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000))
  }
  return loginOnce(personaId)
}

const gql = async (token, query, variables) => {
  const res = await fetch(ROUTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  })
  return { status: res.status, body: await res.json() }
}

console.log('=== E2a proof: demo login endpoint ===')

// ---------------------------------------------------------------- a
console.log('\na) allow-listed persona signs in through the endpoint')
const kendra = await login('kendra')
check('a1 HTTP 200', kendra.http === 200, String(kendra.http))
check('a2 status READY', kendra.body.status === 'READY', kendra.body.status)
check('a3 Supabase issued a session (access + refresh present)',
  Boolean(kendra.body.session?.access_token) && Boolean(kendra.body.session?.refresh_token))
check('a4 token_type is bearer', String(kendra.body.session?.token_type).toLowerCase() === 'bearer')
check('a5 persona shape matches the web AuthAdapter',
  kendra.body.persona?.id === 'kendra' && kendra.body.persona?.personId === 'p_mom'
  && kendra.body.scope?.childId === 'p_nora' && kendra.body.persona?.parent === true)

const kendraId = await verifyBearer(`Bearer ${kendra.body.session.access_token}`)
check('a6 the EXISTING verifier accepts the minted token', kendraId.ok === true, kendraId.reason ?? '')
check('a7 verifier resolves the correct personId', kendraId.ok === true && kendraId.personId === 'p_mom',
  kendraId.ok ? kendraId.personId : '-')

// ---------------------------------------------------------------- b
console.log('\nb) trusted demo marker is present in the verified token')
check('b1 Kendra is marked demo', kendraId.ok === true && kendraId.demo === true)
check('b2 Kendra is not marked guide', kendraId.ok === true && kendraId.demoGuide === false)
check('b3 the login response reports the same marks',
  kendra.body.marks?.demo === true && kendra.body.marks?.demoGuide === false)

const guide = await login('demo-guide')
const guideId = await verifyBearer(`Bearer ${guide.body.session?.access_token ?? ''}`)
check('b4 guide resolves to p_demo_guide', guideId.ok === true && guideId.personId === 'p_demo_guide',
  guideId.ok ? guideId.personId : String(guideId.reason))
check('b5 guide carries demo AND demo_guide', guideId.ok === true && guideId.demo === true && guideId.demoGuide === true)
check('b6 the guide session is a real Supabase session, not a local one',
  Boolean(guide.body.session?.access_token) && guide.body.session?.token_type === 'bearer')

// A token with no marker cannot be produced by this endpoint: every persona gets demo=true, and the
// mint refuses a session whose subject lacks it (MINT_MARKER_MISSING), so the negative is structural.
check('b7 no READY response exists without the demo mark',
  kendra.body.marks.demo === true && guide.body.marks.demo === true)

// ---------------------------------------------------------------- c
console.log('\nc) two personas logging in in parallel get only their own identity')
const [c1, c2] = await Promise.all([login('andre'), login('priya')])
const andreId = await verifyBearer(`Bearer ${c1.body.session?.access_token ?? ''}`)
const priyaId = await verifyBearer(`Bearer ${c2.body.session?.access_token ?? ''}`)
check('c1 andre -> p_dad', andreId.ok === true && andreId.personId === 'p_dad', andreId.ok ? andreId.personId : '-')
check('c2 priya -> p_priya', priyaId.ok === true && priyaId.personId === 'p_priya', priyaId.ok ? priyaId.personId : '-')
check('c3 the two sessions are different tokens',
  c1.body.session.access_token !== c2.body.session.access_token)
check('c4 neither session carries the other identity',
  andreId.ok && priyaId.ok && andreId.personId !== priyaId.personId
  && andreId.sub !== priyaId.sub)
check('c5 Kendra\u2019s earlier session still resolves to Kendra after the parallel logins',
  (await verifyBearer(`Bearer ${kendra.body.session.access_token}`)).personId === 'p_mom')

// ---------------------------------------------------------------- d
console.log('\nd) unknown and unready personas return UNAVAILABLE')
for (const id of ['nobody', 'not-a-persona', 'p_mom']) {
  const r = await login(id)
  check(`d: "${id}" -> UNAVAILABLE`, r.body.status === 'UNAVAILABLE' && r.body.personaId === id,
    `${r.body.status}/${r.body.reason ?? '-'}`)
  check(`d: "${id}" carries no session`, !r.body.session && !r.body.access_token)
}
for (const id of ['rosa', 'felicia', 'simone', 'dwayne']) {
  const r = await login(id)
  check(`d: unseeded Cast v2 "${id}" -> UNAVAILABLE`, r.body.status === 'UNAVAILABLE',
    `${r.body.status}/${r.body.reason ?? '-'}`)
  check(`d: "${id}" never substitutes another identity`, !r.body.personId && !r.body.session)
}

// ---------------------------------------------------------------- e
console.log('\ne) a live GraphQL read as that persona returns only their scoped data')
const EVENTS = `query($childId: ID!, $date: String!) {
  events(childId: $childId, date: $date) { id title start }
}`
// A seeded school day for Nora's household. Ask a small window so the proof does not depend on one
// hand-picked date in the fixtures.
const dates = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']
let kendraEvents = []
let eventDate = ''
for (const date of dates) {
  const r = await gql(kendra.body.session.access_token, EVENTS, { childId: 'p_nora', date })
  if (Array.isArray(r.body.data?.events) && r.body.data.events.length > 0) {
    kendraEvents = r.body.data.events
    eventDate = date
    break
  }
}
check('e1 Kendra (parent) reads her own child\u2019s events', kendraEvents.length > 0,
  `${kendraEvents.length} event(s) on ${eventDate || 'no date in window'}`)

const andreRead = await gql(c1.body.session.access_token, EVENTS, { childId: 'p_nora', date: eventDate })
check('e2 Andre (parent) reads the same child', Array.isArray(andreRead.body.data?.events)
  && andreRead.body.data.events.length === kendraEvents.length)

const priyaRead = await gql(c2.body.session.access_token, EVENTS, { childId: 'p_nora', date: eventDate })
check('e3 Priya (schedule.read grant) reads it through the grant path',
  Array.isArray(priyaRead.body.data?.events) && priyaRead.body.data.events.length === kendraEvents.length)

const dana = await login('dana')
const danaRead = await gql(dana.body.session.access_token, EVENTS, { childId: 'p_nora', date: eventDate })
const danaEvents = danaRead.body.data?.events
check('e4 an unrelated adult gets no Nora data',
  (Array.isArray(danaEvents) && danaEvents.length === 0) || danaRead.body.errors?.[0]?.extensions?.code === 'UNAUTHORIZED',
  JSON.stringify(danaEvents ?? danaRead.body.errors?.[0]?.extensions?.code ?? '-'))

const guideRead = await gql(guide.body.session.access_token, EVENTS, { childId: 'p_nora', date: eventDate })
check('e5 the guide reads sandbox records read-only',
  Array.isArray(guideRead.body.data?.events) && guideRead.body.data.events.length === kendraEvents.length,
  `${guideRead.body.data?.events?.length ?? '-'} event(s) or ${guideRead.body.errors?.[0]?.extensions?.code ?? 'ok'}`)

const guideWrite = await gql(guide.body.session.access_token,
  `mutation { approveRelationship(relationshipId: "r_daniel_to_nora") { id } }`)
check('e6 the guide cannot write through GraphQL',
  guideWrite.body.errors?.[0]?.extensions?.code === 'DEMO_GUIDE_READ_ONLY',
  guideWrite.body.errors?.[0]?.extensions?.code ?? 'no error')

const anonRead = await gql(undefined, EVENTS, { childId: 'p_nora', date: eventDate })
check('e7 no token -> UNAUTHENTICATED',
  anonRead.body.errors?.[0]?.extensions?.code === 'UNAUTHENTICATED',
  anonRead.body.errors?.[0]?.extensions?.code ?? '-')

// ---------------------------------------------------------------- rate limit
console.log('\nf) rate limiting (per persona), last because it consumes the window')
// Drain rather than assume a fresh window: ask until a 429 arrives, then assert the shape of the
// refusal. The per-persona limit is 8/minute, so a 429 must arrive within 8 + a small allowance.
const outcomes = []
let limited = null
for (let i = 0; i < 12 && !limited; i += 1) {
  const r = await loginOnce('jax-family')
  outcomes.push(r.http)
  if (r.http === 429) limited = r
}
check('f1 the per-persona limit produces a 429', Boolean(limited), outcomes.join(','))
check('f2 every response before the 429 was a success',
  outcomes.slice(0, -1).every((s) => s === 200), outcomes.join(','))
check('f3 the refusal is 429 with Retry-After and no session',
  Boolean(limited) && Number(limited.retryAfter) > 0 && !limited.body?.session,
  `retryAfter=${limited?.retryAfter ?? '-'}`)

console.log(failed ? `\nE2a PROOF FAILED: ${failed}` : '\nE2a PROOF PASSED')
process.exit(failed ? 1 : 0)
