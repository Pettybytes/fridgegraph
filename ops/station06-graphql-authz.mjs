#!/usr/bin/env node
/**
 * ops/station06-graphql-authz.mjs — the GraphQL projection through the composed router.
 *
 * Proves, against the running supergraph:
 *   - Kendra (parent/approver) sees her job's evaluations, costs and the over-limit alternative
 *   - a candidate (Loretta, Bryan) sees no job at all: coordination_jobs is parent-only, so there
 *     is nothing to enumerate; her own evaluation row is reachable only through a job she can see
 *   - Walter (unrelated, credentialed) sees nothing
 *   - the over-limit alternative is visibly OVER_POLICY and distinct from APPROVAL_PENDING
 *   - no coordinates or addresses appear anywhere in the responses
 *
 * Fictional responders only. Tokens come from .demo-credentials; nothing is printed.
 */
import pg from 'pg'
import { tokenForPersonId } from './auth.mjs'

const ROUTER = process.env.FRIDGEGRAPH_ROUTER
const URL = process.env.SUPABASE_URL.replace(/\/$/, '')
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const AS_OF = '2026-10-28'
if (!ROUTER) { console.error('FRIDGEGRAPH_ROUTER not set'); process.exit(2) }

const results = []
const rec = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`) }

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const rpc = async (fn, args, token) => {
  const headers = { 'content-type': 'application/json', apikey: SVC }
  if (token) headers.authorization = `Bearer ${token}`
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) })
  const t = await r.text()
  let b = null
  try { b = JSON.parse(t) } catch { /* plain */ }
  return { status: r.status, body: b, text: t }
}

const gql = async (token, query, variables) => {
  const r = await fetch(ROUTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  })
  return { status: r.status, json: await r.json() }
}

const JOBS = `
  query($c: ID!) {
    coordinationJobs(childId: $c) {
      id status version
      overLimitCandidate { id displayName }
      candidateEvaluations {
        candidate { id displayName }
        reasonCode available estimatedRideCostUsd costBasis distanceMiles locationProvenance
      }
      confirmation { id candidate { id displayName } approvedBy { id displayName } overLimitApproved }
    }
  }`

const mom = await tokenForPersonId('p_mom')
const gma = await tokenForPersonId('p_gma')
const bryan = await tokenForPersonId('p_bryan')
const walter = await tokenForPersonId('p_walter')

// ---- fixtures: one mixed night (Tasha wins) and one Loretta-only night -------------------
const mixed = (await rpc('request_pickup', { p_child: 'p_nora', p_as_of: AS_OF, p_window: 'gql-mixed' }, mom)).body
const lone = (await rpc('request_pickup', { p_child: 'p_nora', p_as_of: AS_OF, p_window: 'gql-lone' }, mom)).body

const attemptsOf = async (job) => {
  const r = await db.query(`select a.id, a.candidate_id from attempts a where a.job_id=$1`, [job])
  return Object.fromEntries(r.rows.map(x => [x.candidate_id, x.id]))
}
const hook = (attemptId, available, decline, key) => rpc('accept_pickup_webhook', {
  p_attempt: attemptId, p_available: available, p_decline: decline,
  p_request_version: 1, p_event_id: `gql-${key}-${Date.now()}`, p_payload_sha256: `d-${key}-${available}`,
})

const mA = await attemptsOf(mixed)
await hook(mA.p_gma, true, null, 'mg')
await hook(mA.p_tasha, true, null, 'mt')
await hook(mA.p_bryan, false, 'BUSY', 'mb')
await hook(mA.p_monique, false, 'BUSY', 'mm')

const lA = await attemptsOf(lone)
await hook(lA.p_gma, true, null, 'lg')
await db.query(`update coordination_jobs set discovery_timeout_seconds=0 where id=$1`, [lone])
await db.query(`select close_discovery($1)`, [lone])

// Kendra approves the mixed night (ordinary approval, no over-limit exception)
const mv = (await db.query(`select version from coordination_jobs where id=$1`, [mixed])).rows[0].version
await rpc('approve_pickup', { p_job: mixed, p_version: mv, p_request_version: 1, p_decision: 'APPROVED', p_reason: null, p_accept_over_limit: false }, mom)

// ---- as Kendra ---------------------------------------------------------------------------
const k = await gql(mom, JOBS, { c: 'p_nora' })
const jobs = k.json?.data?.coordinationJobs ?? []
rec('Kendra sees both jobs', jobs.length >= 2, `jobs=${jobs.length} status=${k.status}`)

const mixedJob = jobs.find((j) => j.id === mixed)
const loneJob = jobs.find((j) => j.id === lone)

rec('mixed night is confirmed with no over-limit alternative',
  mixedJob?.status === 'confirmed' && mixedJob?.overLimitCandidate === null,
  `status=${mixedJob?.status} alt=${mixedJob?.overLimitCandidate}`)

const tasha = mixedJob?.candidateEvaluations?.find((e) => e.candidate.id === 'p_tasha')
rec('Kendra sees the recommendation and its computed cost',
  tasha?.reasonCode === 'APPROVAL_PENDING' && Number(tasha?.estimatedRideCostUsd) === 7,
  `code=${tasha?.reasonCode} cost=${tasha?.estimatedRideCostUsd} miles=${tasha?.distanceMiles}`)

const lorettaMixed = mixedJob?.candidateEvaluations?.find((e) => e.candidate.id === 'p_gma')
rec('Kendra sees the over-policy candidate and its cost',
  lorettaMixed?.reasonCode === 'OVER_POLICY' && Number(lorettaMixed?.estimatedRideCostUsd) === 12.4,
  `code=${lorettaMixed?.reasonCode} cost=${lorettaMixed?.estimatedRideCostUsd}`)

rec('confirmation is exposed with its approver and no exception',
  mixedJob?.confirmation?.candidate?.id === 'p_tasha' && mixedJob?.confirmation?.approvedBy?.id === 'p_mom'
    && mixedJob?.confirmation?.overLimitApproved === false,
  `${mixedJob?.confirmation?.candidate?.id}/${mixedJob?.confirmation?.approvedBy?.id} flag=${mixedJob?.confirmation?.overLimitApproved}`)

rec('Loretta-only night exposes her as the over-limit alternative',
  loneJob?.status === 'awaiting_approval' && loneJob?.overLimitCandidate?.id === 'p_gma',
  `status=${loneJob?.status} alt=${loneJob?.overLimitCandidate?.id}`)

const lonePending = (loneJob?.candidateEvaluations ?? []).filter((e) => e.reasonCode === 'APPROVAL_PENDING')
const loneOver = (loneJob?.candidateEvaluations ?? []).find((e) => e.candidate.id === 'p_gma')
rec('over-limit is distinct from APPROVAL_PENDING',
  lonePending.length === 0 && loneOver?.reasonCode === 'OVER_POLICY',
  `approval_pending=${lonePending.length} loretta=${loneOver?.reasonCode}`)

rec('candidate names resolve through the graph', 
  lorettaMixed?.candidate?.displayName === 'Loretta Brooks' && tasha?.candidate?.displayName === 'Tasha Ellison',
  `${lorettaMixed?.candidate?.displayName} / ${tasha?.candidate?.displayName}`)

// ---- candidates and strangers ------------------------------------------------------------
const lg = await gql(gma, JOBS, { c: 'p_nora' })
rec('candidate (Loretta) sees no job list', (lg.json?.data?.coordinationJobs ?? []).length === 0,
  `jobs=${(lg.json?.data?.coordinationJobs ?? []).length}`)

const bg = await gql(bryan, JOBS, { c: 'p_nora' })
rec('candidate (Bryan) sees no job list', (bg.json?.data?.coordinationJobs ?? []).length === 0,
  `jobs=${(bg.json?.data?.coordinationJobs ?? []).length}`)

const wg = await gql(walter, JOBS, { c: 'p_nora' })
const wJobs = wg.json?.data?.coordinationJobs ?? []
rec('unrelated caller (Walter) sees nothing', wJobs.length === 0, `jobs=${wJobs.length}`)

// ---- no coordinates or addresses anywhere ------------------------------------------------
const scan = JSON.stringify([k.json, lg.json, bg.json, wg.json])
const leaks = ['"lat"', '"lng"', '"address"', '"origin"', '"coordinates"', 'latitude', 'longitude']
const found = leaks.filter((l) => scan.toLowerCase().includes(l.toLowerCase()))
rec('no coordinates or addresses in any response', found.length === 0, found.join(',') || 'clean')

// ---- cleanup -----------------------------------------------------------------------------
await db.query(`delete from coordination_jobs where id = any($1)`, [[mixed, lone]])
const left = (await db.query(`select count(*)::int n from coordination_jobs`)).rows[0].n
console.log('cleanup: jobs remaining =', left)
await db.end()

const failed = results.filter((r) => !r.ok)
console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.n).join(' | ')); process.exitCode = 1 }
