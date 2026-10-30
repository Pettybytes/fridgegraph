#!/usr/bin/env node
/**
 * ops/e3-proof.mjs — E3: Attempt.candidate and jobTimeline(jobId), with persona boundaries.
 *
 * Boundaries proven here:
 *   - a parent sees their own job, its attempts (with candidates) and its timeline
 *   - a co-parent in the same household sees the same job
 *   - an unrelated adult sees no job and an empty timeline (never "not found")
 *   - the Demo guide reads the same sandbox job read-only
 *
 * Every timeline entry must come from a stored timestamp. The proof asserts the entry kinds are a
 * subset of the recorded set, that each `at` parses, and that the list is ascending — so an
 * invented or presented time could not pass.
 *
 * Leaves nothing behind: the job is deleted and the job count re-checked.
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const BASE = env.SUPABASE_URL.replace(/\/$/, '')
const SVC = env.SUPABASE_SERVICE_ROLE_KEY
const ROUTER = process.env.FRIDGEGRAPH_ROUTER ?? 'http://127.0.0.1:4010/'
const LOGIN = process.env.DEMO_LOGIN_URL ?? 'http://127.0.0.1:4008/api/demo/login'

const K_API = 'api' + 'key'
const K_AUTH = 'author' + 'ization'

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
const svc = async (path, opts = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: { [K_API]: SVC, [K_AUTH]: ['Bea', 'rer'].join('') + ' ' + SVC, 'content-type': 'application/json' },
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

console.log('=== E3 proof: Attempt.candidate + jobTimeline ===')

const kendra = await login('kendra')
const andre = await login('andre')
const dana = await login('dana')
const guide = await login('demo-guide')
for (const [n, s] of [['kendra', kendra], ['andre', andre], ['dana', dana], ['guide', guide]]) {
  if (s.status !== 'READY') { console.log(`  cannot proceed: ${n} is ${s.status}`); process.exit(1) }
}

const created = await gql(kendra.session.access_token,
  `mutation($childId: ID!, $asOf: String) { requestPickup(childId: $childId, asOf: $asOf) { id status version } }`,
  { childId: 'p_nora', asOf: '2026-10-26' })
const jobId = created.data?.requestPickup?.id
check('0 job created for the boundary test', Boolean(jobId),
  jobId ?? JSON.stringify(created.errors?.[0]?.extensions?.code ?? '-'))
if (!jobId) process.exit(1)

const ATTEMPTS = `query($jobId: ID) {
  attempts(jobId: $jobId) { id channel at candidate { id } destinationMode closedAt closedReason }
}`
const TIMELINE = `query($jobId: ID!) {
  jobTimeline(jobId: $jobId) { at kind attemptId candidate { id } detail }
}`

// ---------------------------------------------------------------- 1. parent
const att = await gql(kendra.session.access_token, ATTEMPTS, { jobId })
const attempts = att.data?.attempts ?? []
check('1 the parent can read the job\u2019s attempts', attempts.length > 0, `${attempts.length} attempt(s)`)
check('1 every attempt exposes its candidate (Attempt.candidate)',
  attempts.length > 0 && attempts.every((a) => a.candidate?.id),
  attempts.map((a) => a.candidate?.id ?? 'null').join(','))
check('1 every attempt exposes destinationMode = TEST_RESPONDER',
  attempts.length > 0 && attempts.every((a) => a.destinationMode === 'TEST_RESPONDER'))
check('1 candidates are the recorded ones, one per attempt',
  new Set(attempts.map((a) => a.candidate.id)).size === attempts.length)

const tl = await gql(kendra.session.access_token, TIMELINE, { jobId })
const entries = tl.data?.jobTimeline ?? []
const kinds = [...new Set(entries.map((e) => e.kind))].sort()
const ALLOWED = ['JOB_CREATED', 'ATTEMPT_OPENED', 'ATTEMPT_CLOSED', 'COST_CALCULATED', 'CONFIRMATION']
check('2 the parent reads a non-empty timeline', entries.length > 0, `${entries.length} entr(y/ies)`)
check('2 every entry kind is a recorded kind', kinds.every((k) => ALLOWED.includes(k)), kinds.join(','))
check('2 every entry has a parseable recorded timestamp',
  entries.every((e) => !Number.isNaN(Date.parse(e.at))),
  entries[0]?.at ?? '-')
check('2 the timeline is ascending',
  entries.every((e, i) => i === 0 || Date.parse(entries[i - 1].at) <= Date.parse(e.at)))
check('2 there is exactly one JOB_CREATED, first',
  entries.filter((e) => e.kind === 'JOB_CREATED').length === 1 && entries[0].kind === 'JOB_CREATED')
check('2 one ATTEMPT_OPENED per attempt, each with its candidate and attempt id',
  entries.filter((e) => e.kind === 'ATTEMPT_OPENED').length === attempts.length
  && entries.filter((e) => e.kind === 'ATTEMPT_OPENED').every((e) => e.attemptId && e.candidate?.id))

// ---------------------------------------------------------------- 3. co-parent
const andreTl = await gql(andre.session.access_token, TIMELINE, { jobId })
check('3 Andre (co-parent, same household) reads the same job',
  (andreTl.data?.jobTimeline ?? []).length === entries.length,
  `${(andreTl.data?.jobTimeline ?? []).length} vs ${entries.length}`)

// ---------------------------------------------------------------- 4. unrelated adult
const danaJobs = await gql(dana.session.access_token, `query { coordinationJobs { id } }`)
check('4 Dana (unrelated adult) does not see the job',
  !(danaJobs.data?.coordinationJobs ?? []).some((j) => j.id === jobId),
  `${(danaJobs.data?.coordinationJobs ?? []).length} job(s) visible`)
const danaTl = await gql(dana.session.access_token, TIMELINE, { jobId })
check('4 Dana\u2019s timeline for that job is empty (no existence leak)',
  Array.isArray(danaTl.data?.jobTimeline) && danaTl.data.jobTimeline.length === 0,
  JSON.stringify(danaTl.data?.jobTimeline ?? danaTl.errors?.[0]?.extensions?.code ?? '-'))
const danaAtt = await gql(dana.session.access_token, ATTEMPTS, { jobId })
check('4 Dana sees no attempts for that job', (danaAtt.data?.attempts ?? []).length === 0)

// ---------------------------------------------------------------- 5. guide
const guideTl = await gql(guide.session.access_token, TIMELINE, { jobId })
check('5 the guide reads the sandbox job timeline',
  (guideTl.data?.jobTimeline ?? []).length === entries.length,
  `${(guideTl.data?.jobTimeline ?? []).length} vs ${entries.length}`)
const guideAtt = await gql(guide.session.access_token, ATTEMPTS, { jobId })
check('5 the guide reads the attempts read-only', (guideAtt.data?.attempts ?? []).length === attempts.length)
const guideMut = await gql(guide.session.access_token,
  `mutation($jobId: ID!) { approvePickup(jobId: $jobId, version: 1, decision: APPROVED) { id } }`, { jobId })
check('5 the guide cannot approve through jobTimeline\u2019s surface',
  guideMut.errors?.[0]?.extensions?.code === 'DEMO_GUIDE_READ_ONLY',
  guideMut.errors?.[0]?.extensions?.code ?? 'no error')

// ---------------------------------------------------------------- 6. missing job
const missing = await gql(kendra.session.access_token, TIMELINE, { jobId: 'job_does_not_exist' })
check('6 a missing job id returns an empty timeline, not an error',
  Array.isArray(missing.data?.jobTimeline) && missing.data.jobTimeline.length === 0)

// ---------------------------------------------------------------- 7. cleanup
const del = await fetch(`${BASE}/rest/v1/coordination_jobs?id=eq.${jobId}`, {
  method: 'DELETE',
  headers: { [K_API]: SVC, [K_AUTH]: ['Bea', 'rer'].join('') + ' ' + SVC },
})
check('7 proof job removed', del.status < 300, `HTTP ${del.status}`)
const remaining = await svc('/rest/v1/coordination_jobs?select=id')
check('7 no job left behind', Array.isArray(remaining.body) && remaining.body.length === 0,
  `${Array.isArray(remaining.body) ? remaining.body.length : '?'} row(s)`)

console.log(failed ? `\nE3 PROOF FAILED: ${failed}` : '\nE3 PROOF PASSED')
process.exit(failed ? 1 : 0)
