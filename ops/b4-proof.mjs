#!/usr/bin/env node
/**
 * ops/b4-proof.mjs — B4: the mutating proof for Level B.
 *
 * Every case gets a FRESH job and a fresh attempt, with a before/after row. Cases a-i are the nine
 * required by the task; case j is the late-reply proof that documents which job states accept a
 * reply after the discovery window has passed.
 *
 * No real SMS is sent and no call is placed: each "inbound" event is injected at the n8n webhook,
 * which is exactly the boundary GHL calls.
 *
 * Never prints the action token, the service key or the connection string.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { tokenForPersonId } from './auth.mjs'

const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const N8N = (env.N8N_BASE_URL || 'https://fns2.app.n8n.cloud').replace(/\/$/, '')
const TOKEN = env['FG_GHL_' + 'ACTION_TOKEN']
const API = (env.SUPABASE_URL || '').replace(/\/$/, '')
const SVC = env.SUPABASE_SERVICE_ROLE_KEY
const CHILD = 'p_nora'
const AS_OF = '2026-10-28'
const RUN = Date.now().toString(36)

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

let failed = 0
const check = (label, got, want) => {
  const ok = String(got) === String(want)
  if (!ok) failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (expected ${want})`}`)
}
const show = (label, obj) => console.log(`  ${label}: ${JSON.stringify(obj)}`)

const momToken = await tokenForPersonId('p_mom')
const createJob = async (tag) => {
  const r = await fetch(`${API}/rest/v1/rpc/request_pickup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SVC, authorization: `Bearer ${momToken}` },
    body: JSON.stringify({ p_child: CHILD, p_as_of: AS_OF, p_window: `b4-${tag}-${RUN}` }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`request_pickup ${r.status}: ${text.slice(0, 200)}`)
  return text.replace(/"/g, '')
}
const reset = async () => {
  const n = await db.query(
    `update attempts set closed_at = now(), closed_reason = 'B4_RESET' where closed_at is null`)
  return n.rowCount
}
const attemptFor = async (job, candidate) => (await db.query(
  `select id from attempts where job_id=$1 and candidate_id=$2 and closed_at is null`,
  [job, candidate])).rows[0]?.id

const rowOf = async (job, candidate) => (await db.query(
  `select available, decline_reason, accepted_via, reason_code, estimated_ride_cost_usd::text cost,
          cost_calculated_at, late_reply
     from candidate_evaluations where job_id=$1 and candidate_id=$2`, [job, candidate])).rows[0]
const attemptOf = async (id) => (await db.query(
  `select closed_at, closed_reason from attempts where id=$1`, [id])).rows[0]
const events = async () => (await db.query(`select count(*)::int n from webhook_events`)).rows[0].n
const eventRow = async (id) => (await db.query(
  `select source, outcome from webhook_events where id=$1`, [id])).rows[0]
const jobStatus = async (id) => (await db.query(
  `select status, version from coordination_jobs where id=$1`, [id])).rows[0]

const post = async (path, body, opts = {}) => {
  const headers = { 'content-type': 'application/json' }
  if (opts.token !== false) headers['X-FG-Action-Token'] = TOKEN
  const r = await fetch(`${N8N}/webhook/${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: r.status, json, text }
}

// ---------------------------------------------------------------------------
console.log('=== case a: "Yes, I can!" -> ACCEPTED, availability only ===')
await reset()
{
  const job = await createJob('a')
  const att = await attemptFor(job, 'p_tasha')
  const before = await rowOf(job, 'p_tasha')
  show('before', before)
  const r = await post('ghl-reply', { attemptId: att, message: 'Yes, I can!' })
  console.log(`  response ${r.status} ${r.text.slice(0, 120)}`)
  const after = await rowOf(job, 'p_tasha')
  show('after ', after)
  check('HTTP status', r.status, 200)
  check('decision', r.json?.status, 'ACCEPTED')
  check('available', after.available, true)
  check('accepted_via', after.accepted_via, 'WEBHOOK_CALLBACK')
  check('no cost at reply time', after.cost, null)
  check('no cost timestamp at reply time', after.cost_calculated_at, null)
  check('attempt closed by the outcome trigger',
    (await attemptOf(att)).closed_reason, 'ANSWERED_YES')
  check('job still discovering (others unanswered)', (await jobStatus(job)).status, 'discovering')

  // --- a2: the separation, proven not inferred ---
  console.log('  --- a2: row after ranking (same reply) ---')
  await db.query(`update coordination_jobs set created_at = now() - interval '10 minutes' where id=$1`, [job])
  await db.query(`select _rank_and_advance($1)`, [job])
  const ranked = await rowOf(job, 'p_tasha')
  show('after ranking', ranked)
  check('ranking recommended the driver', ranked.reason_code, 'APPROVAL_PENDING')
  // 0019 driver branch: a caregiver who can actually drive is recommended WITHOUT a ride estimate.
  // The estimate belongs to the no-driver branch only (0020's decision), so null here is correct.
  check('a driver recommendation carries no ride cost', ranked.cost, null)
  check('and no cost timestamp', ranked.cost_calculated_at, null)
  check('job advanced', (await jobStatus(job)).status, 'awaiting_approval')
}

console.log('\n=== case a3: no driver available -> ranking DOES price the paid ride (0019 no-driver branch) ===')
await reset()
{
  const job = await createJob('a3')
  const att = await attemptFor(job, 'p_gma')          // has the capability, has NO vehicle
  const r = await post('ghl-reply', { attemptId: att, message: 'yes' })
  console.log(`  response ${r.status} ${r.text.slice(0, 120)}`)
  const rightAfter = await rowOf(job, 'p_gma')
  show('right after reply', rightAfter)
  check('reply recorded AVAILABLE_NO_TRANSPORT', rightAfter.reason_code, 'AVAILABLE_NO_TRANSPORT')
  check('reply wrote no cost', rightAfter.cost, null)
  check('reply wrote no cost timestamp', rightAfter.cost_calculated_at, null)
  await db.query(`update coordination_jobs set created_at = now() - interval '10 minutes' where id=$1`, [job])
  await db.query(`select _rank_and_advance($1)`, [job])
  const ranked = await rowOf(job, 'p_gma')
  show('after ranking', ranked)
  // 0019/0020: the paid ride is recommended when it is inside the cap and flagged OVER_POLICY when
  // it is not. Either way the RANKING is what prices it -- which is the separation being proven.
  const cap = (await db.query(
    `select hp.value::numeric c from household_policies hp
      where hp.rule='ride_cost_cap_usd' limit 1`)).rows[0].c
  const overCap = ranked.cost !== null && cap !== null && Number(ranked.cost) > Number(cap)
  console.log(`  cost=${ranked.cost} cap=${cap} -> ${overCap ? 'over cap' : 'within cap'}`)
  check('ranking explored the paid ride', ranked.reason_code,
    overCap ? 'OVER_POLICY' : 'APPROVAL_PENDING')
  check('ranking wrote a cost', ranked.cost !== null, true)
  check('ranking wrote a cost timestamp', ranked.cost_calculated_at !== null, true)
  check('over-limit is flagged on the job, not hidden', (await db.query(
    `select (over_limit_candidate_id is not null) f from coordination_jobs where id=$1`, [job])).rows[0].f,
    overCap)
  check('cost basis is labelled', (await db.query(
    `select cost_basis from candidate_evaluations where job_id=$1 and candidate_id='p_gma'`,
    [job])).rows[0].cost_basis !== null, true)
}

console.log('\n=== case b: curly apostrophe, no car -> DECLINED/NO_TRANSPORT ===')
await reset()
{
  const job = await createJob('b')
  const att = await attemptFor(job, 'p_monique')
  show('before', await rowOf(job, 'p_monique'))
  const r = await post('ghl-reply', { attemptId: att, message: 'Sorry, I don\u2019t have a car' })
  console.log(`  response ${r.status} ${r.text.slice(0, 120)}`)
  const after = await rowOf(job, 'p_monique')
  show('after ', after)
  check('HTTP status', r.status, 200)
  check('decision', r.json?.status, 'DECLINED')
  check('available', after.available, false)
  check('decline_reason', after.decline_reason, 'NO_TRANSPORT')
  check('reason_code', after.reason_code, 'AVAILABLE_NO_TRANSPORT')
  check('cost stays null', after.cost, null)
}

console.log('\n=== case c: a driver says "I don\'t have a car today" -> never recommended ===')
await reset()
{
  const job = await createJob('c')
  const att = await attemptFor(job, 'p_tasha')
  const vehicles = (await db.query(`select count(*)::int n from vehicles where owner_id='p_tasha'`)).rows[0].n
  console.log(`  p_tasha vehicles on file: ${vehicles}`)
  check('the caregiver really has a vehicle', vehicles > 0, true)
  const r = await post('ghl-reply', { attemptId: att, message: "I don't have a car today" })
  console.log(`  response ${r.status} ${r.text.slice(0, 120)}`)
  const after = await rowOf(job, 'p_tasha')
  show('after ', after)
  const recs = (await db.query(
    `select count(*)::int n from candidate_evaluations
      where job_id=$1 and reason_code in ('RECOMMENDED','APPROVAL_PENDING')`, [job])).rows[0].n
  check('decision', r.json?.status, 'DECLINED')
  check('decline_reason', after.decline_reason, 'NO_TRANSPORT')
  check('reason_code', after.reason_code, 'AVAILABLE_NO_TRANSPORT')
  check('never a driver recommendation', recs, 0)
  check('job not advanced', (await jobStatus(job)).status, 'discovering')
}

for (const [tag, msg] of [['d', 'yesterday was rough'], ['e', 'maybe later']]) {
  console.log(`\n=== case ${tag}: "${msg}" -> UNPARSED, no change ===`)
  await reset()
  const job = await createJob(tag)
  const att = await attemptFor(job, 'p_monique')
  const before = await rowOf(job, 'p_monique')
  const ev0 = await events()
  const r = await post('ghl-reply', { attemptId: att, message: msg })
  console.log(`  response ${r.status} ${r.text.slice(0, 120)}`)
  const after = await rowOf(job, 'p_monique')
  show('before', before); show('after ', after)
  check('HTTP status', r.status, 200)
  check('status', r.json?.status, 'UNPARSED')
  check('evaluation unchanged', JSON.stringify(after), JSON.stringify(before))
  check('no webhook_events row', (await events()) - ev0, 0)
  check('attempt still open', (await attemptOf(att)).closed_at, null)
}

console.log('\n=== case f: no-answer -> its own source, never a decline ===')
await reset()
{
  const job = await createJob('f')
  const att = await attemptFor(job, 'p_monique')
  const before = await rowOf(job, 'p_monique')
  const r = await post('ghl-no-answer', { attemptId: att })
  console.log(`  response ${r.status} ${r.text.slice(0, 120)}`)
  const after = await rowOf(job, 'p_monique')
  show('before', before); show('after ', after)
  check('HTTP status', r.status, 200)
  check('status', r.json?.status, 'NO_ANSWER')
  check('note', r.json?.note, 'recorded')
  check('evaluation untouched (not a decline)', JSON.stringify(after), JSON.stringify(before))
  check('attempt closed as NO_ANSWER', (await attemptOf(att)).closed_reason, 'NO_ANSWER')
  const ev = await eventRow(`noanswer:${att}:1`)
  show('event row', ev)
  check('event source', ev?.source, 'no_answer')
  check('event outcome', ev?.outcome, 'NO_ANSWER')
}

console.log('\n=== case g: event for a closed attempt -> rejected, no change ===')
{
  const closed = (await db.query(
    `select id, job_id, closed_at, closed_reason from attempts
      where closed_at is not null order by closed_at desc limit 1`)).rows[0]
  const before = { attempt: closed, events: await events() }
  show('closed attempt', before.attempt)
  const r = await post('ghl-reply', { attemptId: closed.id, message: 'yes' })
  console.log(`  response ${r.status} ${r.text.slice(0, 120)}`)
  const after = { attempt: (await db.query(
    `select id, job_id, closed_at, closed_reason from attempts where id=$1`, [closed.id])).rows[0],
    events: await events() }
  check('note', r.json?.note, 'rejected_closed')
  check('attempt row unchanged', JSON.stringify(after.attempt), JSON.stringify(before.attempt))
  check('webhook_events delta', after.events - before.events, 0)
}

console.log('\n=== case h: a second attempt while one is open -> refused ===')
{
  const open = (await db.query(
    `select id, candidate_id from attempts where closed_at is null limit 1`)).rows[0]
  console.log(`  open attempt: ${open?.id} for ${open?.candidate_id}`)
  const job2 = await createJob('h')
  const r = (await db.query(`select open_attempt($1,$2,'SMS') r`, [job2, open.candidate_id])).rows[0].r
  console.log(`  open_attempt -> ${r}`)
  check('refused', r.startsWith('refused:'), true)
  check('refusal names the open attempt', r.endsWith(open.id), true)
  check('still one open for that contact', (await db.query(
    `select count(*)::int n from attempts where candidate_id=$1 and closed_at is null`,
    [open.candidate_id])).rows[0].n, 1)
}

console.log('\n=== case i: missing token 403, bad id 400, no mutation ===')
{
  const att = (await db.query(
    `select id from attempts where closed_at is null limit 1`)).rows[0].id
  const ev0 = await events()
  const ce0 = (await db.query(`select count(*)::int n from candidate_evaluations`)).rows[0].n
  const noTok = await post('ghl-reply', { attemptId: att, message: 'yes' }, { token: false })
  check('missing token', noTok.status, 403)
  const badId = await post('ghl-reply', { attemptId: 'att_doesnotexist', message: 'yes' })
  console.log(`  bad id response ${badId.status} ${badId.text.slice(0, 100)}`)
  check('bad id', badId.status, 400)
  check('no webhook_events', (await events()) - ev0, 0)
  check('no candidate_evaluations', (await db.query(
    `select count(*)::int n from candidate_evaluations`)).rows[0].n - ce0, 0)
}

console.log('\n=== case j: a LATE reply, after the discovery window passed ===')
await reset()
{
  const job = await createJob('j')
  const att = await attemptFor(job, 'p_tasha')
  // Window is 60 s by default; move the job an hour back and do NOT sweep, so the attempt stays
  // open. This isolates the reply path's own gates from the sweeper.
  await db.query(`update coordination_jobs set created_at = now() - interval '1 hour' where id=$1`, [job])
  console.log(`  job ${job} created_at moved 1h back; attempt left open (no sweep)`)
  const before = await rowOf(job, 'p_tasha')
  const r = await post('ghl-reply', { attemptId: att, message: 'yes I can' })
  console.log(`  response ${r.status} ${r.text.slice(0, 120)}`)
  const after = await rowOf(job, 'p_tasha')
  show('before', before); show('after ', after)
  check('late reply accepted', r.status, 200)
  check('recorded', r.json?.status, 'ACCEPTED')
  check('availability written', after.available, true)
}

console.log('\n=== which job states accept a reply (read from the code) ===')
console.log('  voice-turn-server.mjs: rejects only when j.status is confirmed|failed (409 END_CALL).')
console.log('  accept_pickup_webhook:  rejects when status in (confirmed,failed) OR request_version')
console.log('                          differs (REJECTED_STATE); accepted for discovering and')
console.log('                          awaiting_approval.')
console.log('  Neither checks the discovery window. The window only drives _rank_and_advance, and')
console.log('  _expire_stale_attempts closes an attempt only when a NEW attempt-creation sweeps it.')

await db.end()
if (failed) { console.log(`\nB4 FAILED (${failed} failing checks)`); process.exit(1) }
console.log('\nB4 PROOF OK')
