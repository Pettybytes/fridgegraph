#!/usr/bin/env tsx
/**
 * ops/station06-verify.mjs — repeatable proof for the Station 06 coordination boundary.
 *
 *   npm run verify:station06              # run everything, clean up afterwards
 *   npm run verify:station06 -- --keep    # leave the confirmed job in place for a demo
 *
 * What it proves:
 *   A. Direct write paths are closed (anon RPC, authenticated table write, authenticated consume)
 *   B. Every transition is gated by the contract's rule (parent / candidate / approverFor)
 *   C. The webhook entry point records availability only, and is idempotent under duplicate delivery
 *   D. The demo walk: Loretta available -> OVER_POLICY at the computed cost; Tasha available ->
 *      APPROVAL_PENDING; Kendra's approval creates the single confirmation
 *   E. The real-call authorization is single-use and bound to id + attempt + recipient + version
 *   F. Candidate origins are invisible through the child's scope
 *
 * No secrets live in this file: every credential is read from the environment (.env), and no
 * token is printed. Test artifacts are removed in the same run unless --keep is passed.
 */
import pg from 'pg'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { tokenForPersonId } from './auth.mjs'

const URL = process.env.SUPABASE_URL?.replace(/\/$/, '')
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY
const KEEP = process.argv.includes('--keep')
const AS_OF = '2026-10-28'   // a Wednesday: Kendra is the approver, Andre is not

if (!URL || !SVC || !PUB || !process.env.SUPABASE_DB_URL) {
  console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY / SUPABASE_DB_URL')
  process.exit(2)
}

const results = []
const rec = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`) }
const svcHeaders = { apikey: SVC }
const asUser = (tok) => ({ apikey: PUB, authorization: `Bearer ${tok}` })

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

// Capability gates: the fallback and dedupe cases only activate once 0017/0018 are applied, so this
// harness stays green (and honest about what it has not yet proven) in between.
const hasOverLimit = (await db.query(`select count(*)::int n from information_schema.columns
  where table_name='coordination_jobs' and column_name='over_limit_candidate_id'`)).rows[0].n > 0
const hasEvents = (await db.query(`select count(*)::int n from information_schema.tables
  where table_name='webhook_events'`)).rows[0].n > 0

async function rpc(fn, args, headers = svcHeaders) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(args),
  })
  const text = await r.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* plain */ }
  return { status: r.status, text, body }
}
const err = (r, code) => r.status >= 400 && new RegExp(code).test(r.text)

// ---------------------------------------------------------------- A. closed write paths
const anon = await rpc('request_pickup', { p_child: 'p_nora', p_as_of: AS_OF, p_window: 'verify' }, { apikey: PUB })
rec('anon cannot call request_pickup', anon.status === 401 || anon.status === 403, `status=${anon.status}`)

const mom = await tokenForPersonId('p_mom')
const gma = await tokenForPersonId('p_gma')
const bryan = await tokenForPersonId('p_bryan')
const dad = await tokenForPersonId('p_dad')

const direct = await fetch(`${URL}/rest/v1/candidate_evaluations`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...asUser(mom) },
  body: JSON.stringify({ id: 'x', job_id: 'x', candidate_id: 'p_gma', reason_code: 'APPROVAL_PENDING' }),
})
rec('authenticated cannot INSERT candidate_evaluations', direct.status === 401 || direct.status === 403, `status=${direct.status}`)

const userConsume = await rpc('consume_real_call_authorization', { p_id: 'x', p_attempt: 'x', p_recipient: 'x', p_request_version: 1 }, asUser(mom))
rec('authenticated cannot consume an authorization', userConsume.status === 401 || userConsume.status === 403, `status=${userConsume.status}`)

// ---------------------------------------------------------------- B. transition gating
const caregiverReq = await rpc('request_pickup', { p_child: 'p_nora', p_as_of: AS_OF, p_window: 'verify' }, asUser(gma))
rec('caregiver cannot request a pickup', err(caregiverReq, 'UNAUTHORIZED'), `status=${caregiverReq.status}`)

const created = await rpc('request_pickup', { p_child: 'p_nora', p_as_of: AS_OF, p_window: 'verify' }, asUser(mom))
const jobId = typeof created.body === 'string' ? created.body : null
rec('parent creates the job', created.status < 300 && !!jobId, `job=${jobId?.slice(0, 10)}…`)
const again = await rpc('request_pickup', { p_child: 'p_nora', p_as_of: AS_OF, p_window: 'verify' }, asUser(mom))
rec('create is idempotent', again.body === jobId)

const evals = await db.query(`select ce.candidate_id, ce.reason_code, a.id as attempt_id
  from candidate_evaluations ce
  left join attempts a on a.job_id = ce.job_id and a.candidate_id = ce.candidate_id
  where ce.job_id = $1 order by ce.candidate_id`, [jobId])
const attempts = Object.fromEntries(evals.rows.map(r => [r.candidate_id, r.attempt_id]))
rec('contacted candidates start PENDING', evals.rows.filter(r => r.reason_code === 'PENDING').length > 0,
  `pending=${evals.rows.filter(r => r.reason_code === 'PENDING').length} unauthorized=${evals.rows.filter(r => r.reason_code === 'UNAUTHORIZED').length}`)

const wrongCandidate = await rpc('accept_pickup', { p_attempt: attempts.p_bryan, p_available: true, p_decline: null, p_entry: 'CANDIDATE_JWT', p_request_version: 1 }, asUser(gma))
rec('cannot answer for another candidate', err(wrongCandidate, 'UNAUTHORIZED'))

const stale = await rpc('accept_pickup', { p_attempt: attempts.p_gma, p_available: true, p_decline: null, p_entry: 'CANDIDATE_JWT', p_request_version: 2 }, asUser(gma))
rec('stale request_version refused', err(stale, 'STALE_REQUEST_VERSION'))

// ---------------------------------------------------------------- C/D. webhook walk
// The trusted handler calls this service-role function after verifying HMAC + timestamp + event id.
const hook = (candidate, available, decline) =>
  rpc('accept_pickup_webhook', { p_attempt: attempts[candidate], p_available: available, p_decline: decline, p_request_version: 1 })

const gmaReply = await hook('p_gma', true, null)
rec('webhook records Loretta available', gmaReply.status < 300 && gmaReply.body === 'recorded', `body=${JSON.stringify(gmaReply.body)}`)

const gmaEval = await db.query(`select reason_code, available, distance_miles, estimated_ride_cost_usd from candidate_evaluations where job_id=$1 and candidate_id='p_gma'`, [jobId])
rec('Loretta ends OVER_POLICY at the computed cost',
  gmaEval.rows[0]?.reason_code === 'OVER_POLICY' && Number(gmaEval.rows[0]?.estimated_ride_cost_usd) === 12.40,
  `code=${gmaEval.rows[0]?.reason_code} miles=${gmaEval.rows[0]?.distance_miles} cost=${gmaEval.rows[0]?.estimated_ride_cost_usd}`)

const replay = await hook('p_gma', true, null)
rec('duplicate delivery changes nothing', replay.body === 'duplicate', `body=${JSON.stringify(replay.body)}`)

const tashaReply = await hook('p_tasha', true, null)
rec('webhook records Tasha available', tashaReply.status < 300, `body=${JSON.stringify(tashaReply.body)}`)
await hook('p_bryan', false, 'BUSY')
await hook('p_monique', false, 'BUSY')

const job = await db.query(`select status, version from coordination_jobs where id=$1`, [jobId])
rec('job reaches awaiting_approval', job.rows[0]?.status === 'awaiting_approval', `status=${job.rows[0]?.status} v=${job.rows[0]?.version}`)

const recs = await db.query(`select candidate_id, reason_code from candidate_evaluations where job_id=$1 and reason_code='APPROVAL_PENDING'`, [jobId])
rec('exactly one APPROVAL_PENDING, and it is Tasha',
  recs.rowCount === 1 && recs.rows[0].candidate_id === 'p_tasha', `candidate=${recs.rows[0]?.candidate_id}`)

const tashaEval = await db.query(`select distance_miles, estimated_ride_cost_usd, location_provenance from candidate_evaluations where job_id=$1 and candidate_id='p_tasha'`, [jobId])
rec('Tasha is inside the cap with a computed estimate',
  Number(tashaEval.rows[0]?.estimated_ride_cost_usd) <= 10 && tashaEval.rows[0]?.location_provenance === 'ESTIMATED',
  `miles=${tashaEval.rows[0]?.distance_miles} cost=${tashaEval.rows[0]?.estimated_ride_cost_usd} provenance=${tashaEval.rows[0]?.location_provenance}`)

// ---------------------------------------------------------------- approval gate
const v = job.rows[0].version
const dadApprove = await rpc('approve_pickup', { p_job: jobId, p_version: v, p_request_version: 1, p_decision: 'APPROVED', p_reason: null }, asUser(dad))
rec('non-approver parent refused', err(dadApprove, 'UNAUTHORIZED'))
const gmaApprove = await rpc('approve_pickup', { p_job: jobId, p_version: v, p_request_version: 1, p_decision: 'APPROVED', p_reason: null }, asUser(gma))
rec('caregiver cannot approve', err(gmaApprove, 'UNAUTHORIZED'))
const staleApprove = await rpc('approve_pickup', { p_job: jobId, p_version: 1, p_request_version: 1, p_decision: 'APPROVED', p_reason: null }, asUser(mom))
rec('stale version refused', err(staleApprove, 'STALE_VERSION'))

const approved = await rpc('approve_pickup', { p_job: jobId, p_version: v, p_request_version: 1, p_decision: 'APPROVED', p_reason: null }, asUser(mom))
const conf = await db.query(`select candidate_id, approved_by from confirmations where job_id=$1`, [jobId])
const fin = await db.query(`select status from coordination_jobs where id=$1`, [jobId])
rec('Kendra approves and the job is confirmed', approved.status < 300 && fin.rows[0].status === 'confirmed', `status=${fin.rows[0].status}`)
rec('exactly one confirmation, naming candidate and approver',
  conf.rowCount === 1 && conf.rows[0].candidate_id === 'p_tasha' && conf.rows[0].approved_by === 'p_mom',
  `${conf.rows[0]?.candidate_id}/${conf.rows[0]?.approved_by}`)

rec('terminal job rejects a late accept', err(await hook('p_tasha', false, 'BUSY'), 'JOB_TERMINAL'))
rec('second approval refused',
  err(await rpc('approve_pickup', { p_job: jobId, p_version: v + 1, p_request_version: 1, p_decision: 'APPROVED', p_reason: null }, asUser(mom)), 'JOB_TERMINAL'))

// ---------------------------------------------------------------- E. real-call gate
const attemptA = attempts.p_tasha
const attemptB = attempts.p_bryan
for (const id of ['rca_a', 'rca_b', 'rca_c', 'rca_d']) {
  await db.query(`insert into real_call_authorizations (id, attempt_id, request_version, recipient_ref, expires_at)
    values ($1, $2, 1, 'rcpt-' || $1, now() + interval '5 minutes') on conflict (id) do nothing`, [id, attemptA])
}
const consume = (args) => rpc('consume_real_call_authorization', args, svcHeaders)
rec('authorization consumes once', (await consume({ p_id: 'rca_a', p_attempt: attemptA, p_recipient: 'rcpt-rca_a', p_request_version: 1 })).body === true)
rec('second consume is false', (await consume({ p_id: 'rca_a', p_attempt: attemptA, p_recipient: 'rcpt-rca_a', p_request_version: 1 })).body === false)
rec('wrong recipient is false', (await consume({ p_id: 'rca_b', p_attempt: attemptA, p_recipient: 'rcpt-WRONG', p_request_version: 1 })).body === false)
rec('wrong attempt is false', (await consume({ p_id: 'rca_c', p_attempt: attemptB, p_recipient: 'rcpt-rca_c', p_request_version: 1 })).body === false)
rec('wrong request version is false', (await consume({ p_id: 'rca_d', p_attempt: attemptA, p_recipient: 'rcpt-rca_d', p_request_version: 2 })).body === false)

// ---------------------------------------------------------------- F. location disclosure
const locs = await fetch(`${URL}/rest/v1/locations?select=owner_type`, { headers: asUser(mom) })
const rows = await locs.json()
const personRows = Array.isArray(rows) ? rows.filter(r => r.owner_type === 'PERSON') : []
const childRows = Array.isArray(rows) ? rows.filter(r => r.owner_type === 'CHILD') : []
rec('parent sees zero candidate origins', personRows.length === 0, `person_rows=${personRows.length}`)
rec('parent sees the child location', childRows.length > 0, `child_rows=${childRows.length}`)

// ---------------------------------------------------------------- G. over-limit fallback (0017)
const hookOn = (attemptId, available, decline, rv = 1) =>
  rpc('accept_pickup_webhook', { p_attempt: attemptId, p_available: available, p_decline: decline, p_request_version: rv })

if (hasOverLimit) {
  const mixed = await db.query(`select over_limit_candidate_id from coordination_jobs where id=$1`, [jobId])
  rec('mixed night: no over-limit alternative recorded', mixed.rows[0].over_limit_candidate_id === null,
    `over_limit=${mixed.rows[0].over_limit_candidate_id}`)

  // Loretta-only night: only she replies, everyone else times out.
  const lon = await rpc('request_pickup', { p_child: 'p_nora', p_as_of: AS_OF, p_window: 'loretta-only' }, asUser(mom))
  const loneId = lon.body
  const loneAttempts = await db.query(`select a.id, a.candidate_id from attempts a where a.job_id=$1`, [loneId])
  const gmaA = loneAttempts.rows.find(r => r.candidate_id === 'p_gma')?.id
  await hookOn(gmaA, true, null)
  await db.query(`update coordination_jobs set discovery_timeout_seconds=0 where id=$1`, [loneId])
  await db.query(`select close_discovery($1)`, [loneId])

  const lone = await db.query(`select status, over_limit_candidate_id from coordination_jobs where id=$1`, [loneId])
  rec('Loretta-only night surfaces her as the over-limit alternative',
    lone.rows[0].status === 'awaiting_approval' && lone.rows[0].over_limit_candidate_id === 'p_gma',
    `status=${lone.rows[0].status} alt=${lone.rows[0].over_limit_candidate_id}`)

  const lonePending = await db.query(`select count(*)::int n from candidate_evaluations where job_id=$1 and reason_code='APPROVAL_PENDING'`, [loneId])
  rec('over-limit alternative never looks like APPROVAL_PENDING', lonePending.rows[0].n === 0,
    `approval_pending=${lonePending.rows[0].n}`)

  const loneVer = (await db.query(`select version from coordination_jobs where id=$1`, [loneId])).rows[0].version
  const implicit = await rpc('approve_pickup', { p_job: loneId, p_version: loneVer, p_request_version: 1, p_decision: 'APPROVED', p_reason: null }, asUser(mom))
  rec('approving an over-limit option implicitly is refused', err(implicit, 'OVER_LIMIT_NOT_ACCEPTED'), `status=${implicit.status}`)
  const none = await db.query(`select count(*)::int n from confirmations where job_id=$1`, [loneId])
  rec('the refused approval created no confirmation', none.rows[0].n === 0, `confirmations=${none.rows[0].n}`)

  const explicit = await rpc('approve_pickup', { p_job: loneId, p_version: loneVer, p_request_version: 1, p_decision: 'APPROVED', p_reason: null, p_accept_over_limit: true }, asUser(mom))
  const conf2 = await db.query(`select candidate_id, over_limit_approved from confirmations where job_id=$1`, [loneId])
  rec('the explicit exception approves and is recorded',
    explicit.status < 300 && conf2.rowCount === 1 && conf2.rows[0].over_limit_approved === true,
    `candidate=${conf2.rows[0]?.candidate_id} flag=${conf2.rows[0]?.over_limit_approved}`)
  if (!KEEP) await db.query(`delete from coordination_jobs where id=$1`, [loneId])
} else {
  console.log('SKIP  over-limit fallback cases (0017 not applied)')
}

// ---------------------------------------------------------------- H. signed HTTP boundary (0018)
if (hasEvents) {
  const port = 4117
  const srv = spawn(process.execPath, ['ops/webhook-reply-server.mjs'], {
    env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let srvErr = ''
  srv.stderr.on('data', d => { srvErr += String(d) })
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server timeout: ' + srvErr.slice(0, 120))), 8000)
    srv.stdout.on('data', d => { if (String(d).includes('webhook-reply-server on')) { clearTimeout(t); resolve() } })
    srv.on('exit', c => { clearTimeout(t); reject(new Error('server exited ' + c + ' ' + srvErr.slice(0, 120))) })
  }).catch(e => { console.log('SKIP  http cases (' + e.message + ')') })

  const url = `http://127.0.0.1:${port}/webhooks/coordination/reply`
  const secret = process.env.N8N_WEBHOOK_SECRET
  const sign = (ts, raw) => crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')
  const now = () => Math.floor(Date.now() / 1000)
  const post = async (raw, ts, sig) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fridgegraph-timestamp': String(ts), 'x-fridgegraph-signature': String(sig) }, body: raw })
    return { status: r.status, body: await r.text() }
  }

  // A fresh job, so the HTTP cases cannot disturb the walk above.
  const h = await rpc('request_pickup', { p_child: 'p_nora', p_as_of: AS_OF, p_window: 'http' }, asUser(mom))
  const httpJob = h.body
  const httpAttempts = await db.query(`select a.id, a.candidate_id, a.destination, a.channel from attempts a where a.job_id=$1`, [httpJob])
  const t = httpAttempts.rows.find(r => r.candidate_id === 'p_bryan')
  const payload = JSON.stringify({ eventId: 'evt-http-1', attemptId: t.id, requestVersion: 1, available: false, declineReason: 'BUSY', recipient: t.destination, channel: t.channel })
  const ts = now()

  const bad = await post(payload, ts, 'deadbeef'.repeat(8))
  rec('bad signature rejected 401', bad.status === 401, `status=${bad.status}`)

  const expired = await post(payload, ts - 400, sign(ts - 400, payload))
  rec('expired timestamp rejected 401', expired.status === 401, `status=${expired.status}`)

  const malformed = await post('{not json', ts, sign(ts, '{not json'))
  rec('malformed body rejected 400', malformed.status === 400, `status=${malformed.status}`)

  const mismatched = JSON.stringify({ ...JSON.parse(payload), recipient: 'wrong-recipient' })
  const mis = await post(mismatched, ts, sign(ts, mismatched))
  rec('binding mismatch rejected 400', mis.status === 400 && /BINDING/.test(mis.body), `status=${mis.status}`)

  const before = await db.query(`select reason_code, available from candidate_evaluations where job_id=$1 and candidate_id='p_bryan'`, [httpJob])
  const good = await post(payload, ts, sign(ts, payload))
  rec('valid signed reply accepted 200', good.status === 200, `status=${good.status} body=${good.body.slice(0, 40)}`)

  const after = await db.query(`select reason_code, available from candidate_evaluations where job_id=$1 and candidate_id='p_bryan'`, [httpJob])
  rec('the valid reply is persisted', after.rows[0].available === false && after.rows[0].reason_code === 'UNAVAILABLE',
    `available=${after.rows[0].available} code=${after.rows[0].reason_code}`)

  rec('rejections left state untouched', before.rows[0].available === null, `pre_available=${before.rows[0].available}`)

  const dup = await post(payload, ts, sign(ts, payload))
  rec('duplicate event id rejected 409', dup.status === 409, `status=${dup.status}`)

  const ev = await db.query(`select count(*)::int n from webhook_events where id='evt-http-1'`)
  rec('event id recorded once', ev.rows[0].n === 1, `rows=${ev.rows[0].n}`)

  // The same state is visible through GraphQL when a router is provided.
  if (process.env.FRIDGEGRAPH_ROUTER) {
    const q = await fetch(process.env.FRIDGEGRAPH_ROUTER, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${mom}` },
      body: JSON.stringify({ query: `query($id: ID!){ coordinationJob(id:$id){ id status } }`, variables: { id: httpJob } }),
    })
    const qb = await q.json()
    rec('job state visible through GraphQL', !!qb?.data?.coordinationJob, JSON.stringify(qb?.data ?? qb?.errors ?? {}).slice(0, 80))
  } else {
    console.log('SKIP  graphql visibility (no FRIDGEGRAPH_ROUTER)')
  }

  srv.kill()
  if (!KEEP) await db.query(`delete from coordination_jobs where id=$1`, [httpJob])
  await db.query(`delete from webhook_events where id='evt-http-1'`)
} else {
  console.log('SKIP  signed HTTP boundary cases (0018 not applied)')
}

// ---------------------------------------------------------------- cleanup
await db.query(`delete from real_call_authorizations where id like 'rca_%'`)
if (!KEEP) await db.query(`delete from coordination_jobs where id=$1`, [jobId])
else console.log(`\nkept job ${jobId}`)
await db.end()

const failed = results.filter(r => !r.ok)
console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join(' | ')); process.exitCode = 1 }
