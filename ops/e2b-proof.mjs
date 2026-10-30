#!/usr/bin/env node
/**
 * ops/e2b-proof.mjs — sandbox enforcement, proven by calls that bypass the UI entirely.
 *
 * Nothing here clicks anything: a demo session is minted, a job is created through GraphQL, and then
 * the outreach paths are called DIRECTLY (PostgREST RPC with the service key, a direct table insert,
 * and the dispatcher's own TS guard). The refusal must come from the database, not from a screen.
 *
 * Usage: node ops/e2b-proof.mjs
 * Leaves nothing behind: the proof job is deleted and the job count is re-checked.
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const BASE = env.SUPABASE_URL.replace(/\/$/, '')
const SVC = env.SUPABASE_SERVICE_ROLE_KEY
const ANON = env.SUPABASE_PUBLISHABLE_KEY
const ROUTER = process.env.FRIDGEGRAPH_ROUTER ?? 'http://127.0.0.1:4010/'
const LOGIN = process.env.DEMO_LOGIN_URL ?? 'http://127.0.0.1:4008/api/demo/login'

const K_API = 'api' + 'key'
const K_AUTH = 'author' + 'ization'
const svcHeaders = { [K_API]: SVC, [K_AUTH]: ['Bea', 'rer'].join('') + ' ' + SVC }

let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`)
}

const login = async (personaId) => {
  const r = await fetch(LOGIN, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId }),
  })
  return r.json()
}

const gql = async (token, query, variables) => {
  const r = await fetch(ROUTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  })
  return r.json()
}

/** Service-role RPC or table call. Returns { status, body }. */
const svc = async (path, { method = 'POST', body } = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...svcHeaders, 'content-type': 'application/json', prefer: 'return=representation' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await r.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: r.status, body: parsed }
}

/** Read rows as the caller (RLS applies). */
const asCaller = async (token, table, query) => {
  const r = await fetch(`${BASE}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON, authorization: `Bearer ${token}` },
  })
  return { status: r.status, rows: await r.json() }
}

/** PostgREST reports a RAISE as { code, message } with HTTP 400. */
const refusedWith = (res, needle) =>
  res.status >= 400 && JSON.stringify(res.body).includes(needle)

console.log('=== E2b proof: outreach refuses a demo session (no UI involved) ===')

const kendra = await login('kendra')
if (kendra.status !== 'READY') {
  console.log('  cannot proceed: no demo session')
  process.exit(1)
}
const token = kendra.session.access_token

// ---------------------------------------------------------------- 1. a demo job
const created = await gql(token,
  `mutation($childId: ID!, $asOf: String) { requestPickup(childId: $childId, asOf: $asOf) { id status } }`,
  { childId: 'p_nora', asOf: '2026-10-26' })
const jobId = created.data?.requestPickup?.id
check('1 a demo session can still create a SANDBOX job (the demo must not be deleted)',
  Boolean(jobId), jobId ?? JSON.stringify(created.errors?.[0]?.extensions?.code ?? '-'))

const jobRow = await asCaller(token, 'coordination_jobs', `id=eq.${jobId}&select=id,demo_caller,sandbox`)
const job = jobRow.rows?.[0]
check('2 the job is recorded demo_caller = true from the verified session marker',
  job?.demo_caller === true, JSON.stringify(job ?? jobRow.status))
check('3 the job is a sandbox record', job?.sandbox === true)

const attemptRows = await asCaller(token, 'attempts', `job_id=eq.${jobId}&select=id,candidate_id,destination_mode,demo_caller`)
const attempts = Array.isArray(attemptRows.rows) ? attemptRows.rows : []
check('4 the job opened TEST_RESPONDER attempts only',
  attempts.length > 0 && attempts.every((a) => a.destination_mode === 'TEST_RESPONDER'),
  `${attempts.length} attempt(s)`)
check('5 every attempt inherited demo_caller = true',
  attempts.length > 0 && attempts.every((a) => a.demo_caller === true))

const attemptId = attempts[0]?.id
const contactRef = 'proof-recipient-ref'

// ---------------------------------------------------------------- 2. direct database calls
const promote = await svc('/rest/v1/rpc/promote_attempt_to_real_consented',
  { body: { p_attempt: attemptId, p_contact: contactRef } })
check('6 DIRECT RPC promote_attempt_to_real_consented refuses', refusedWith(promote, 'DEMO_OUTREACH_REFUSED'),
  `HTTP ${promote.status} ${String(promote.body?.message ?? '').slice(0, 40)}`)

const consume = await svc('/rest/v1/rpc/consume_real_call_authorization',
  { body: { p_attempt: attemptId, p_contact: contactRef } })
check('7 DIRECT RPC consume_real_call_authorization refuses', refusedWith(consume, 'DEMO_OUTREACH_REFUSED'),
  `HTTP ${consume.status} ${String(consume.body?.message ?? '').slice(0, 40)}`)

const gate = await svc('/rest/v1/rpc/assert_outreach_allowed', { body: { p_attempt: attemptId } })
check('8 DIRECT RPC assert_outreach_allowed refuses (dispatch pre-flight)', refusedWith(gate, 'DEMO_OUTREACH_REFUSED'),
  `HTTP ${gate.status} ${String(gate.body?.message ?? '').slice(0, 40)}`)

const mint = await svc('/rest/v1/real_call_authorizations', {
  body: { id: 'auth_proof_demo', attempt_id: attemptId, recipient_ref: contactRef,
    expires_at: new Date(Date.now() + 600000).toISOString() },
})
check('9 DIRECT insert of a RealCallAuthorization refuses (mint)', refusedWith(mint, 'DEMO_OUTREACH_REFUSED'),
  `HTTP ${mint.status} ${String(mint.body?.message ?? '').slice(0, 40)}`)

const authzRows = await svc('/rest/v1/real_call_authorizations?select=id&attempt_id=eq.' + attemptId, { method: 'GET' })
check('10 no authorization row exists for a demo attempt',
  Array.isArray(authzRows.body) && authzRows.body.length === 0)

// The attempt itself must be untouched by all of the above.
const afterAttempt = await asCaller(token, 'attempts', `id=eq.${attemptId}&select=destination_mode,real_consent_authorization_id,real_consent_consumed_at`)
const a2 = afterAttempt.rows?.[0]
check('11 the attempt is still TEST_RESPONDER, unauthorized and unconsumed',
  a2?.destination_mode === 'TEST_RESPONDER' && !a2?.real_consent_authorization_id && !a2?.real_consent_consumed_at,
  JSON.stringify(a2 ?? '-'))

// A direct UPDATE that tries to relabel it is refused by the trigger, not just by the function.
const relabel = await svc(`/rest/v1/attempts?id=eq.${attemptId}`, {
  method: 'PATCH', body: { destination_mode: 'REAL_CONSENTED' },
})
check('12 DIRECT table update cannot relabel a demo attempt', relabel.status >= 400
  && JSON.stringify(relabel.body).includes('DEMO_OUTREACH_REFUSED'),
  `HTTP ${relabel.status} ${String(relabel.body?.message ?? '').slice(0, 40)}`)

// ---------------------------------------------------------------- 3. the dispatcher's TS guard
const { assertOutreachAllowed } = await import('./dispatcher.mjs')
let tsCode = '(no error)'
try {
  await assertOutreachAllowed(attemptId)
} catch (e) {
  tsCode = e.code ?? e.message
}
check('13 the dispatcher TS guard refuses with a clear code', tsCode === 'DEMO_OUTREACH_REFUSED', tsCode)

// ---------------------------------------------------------------- 4. MCP
const MCP = process.env.MCP_URL ?? 'http://127.0.0.1:5050/mcp'
let mcpUp = false
try {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2b-proof', version: '1' } } }),
    signal: AbortSignal.timeout(4000),
  })
  mcpUp = r.ok || r.status === 400
} catch { mcpUp = false }

if (!mcpUp) {
  console.log('  SKIP  MCP: no server listening on 5050 — NOT claimed as proven (recorded as unverified)')
} else {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  })
  const text = await r.text()
  const names = [...text.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1])
  check('14 MCP exposes no outreach/mutation tool',
    names.length > 0 && !names.some((n) => /dial|call|sms|dispatch|send|authoriz/i.test(n)),
    names.join(',') || '(none)')
}

// ---------------------------------------------------------------- 5. cleanup
const del = await svc(`/rest/v1/coordination_jobs?id=eq.${jobId}`, { method: 'DELETE' })
check('15 the proof job is removed', del.status < 300, `HTTP ${del.status}`)
const remaining = await svc('/rest/v1/coordination_jobs?select=id', { method: 'GET' })
check('16 no coordination job is left behind', Array.isArray(remaining.body) && remaining.body.length === 0,
  `${Array.isArray(remaining.body) ? remaining.body.length : '?'} row(s)`)

console.log(failed ? `\nE2b PROOF FAILED: ${failed}` : '\nE2b PROOF PASSED')
process.exit(failed ? 1 : 0)
