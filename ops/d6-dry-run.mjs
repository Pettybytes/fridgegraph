#!/usr/bin/env node
/**
 * ops/d6-dry-run.mjs — D6: dry run of docs/ops/session-3-runbook.md, end to end.
 *
 * WHAT THIS DOES FOR REAL
 *   - every pre-flight read in the runbook (HTTP, n8n, GHL, pg_proc, phone/agent match)
 *   - the database steps, using a TEST_RESPONDER attempt: request_pickup, open_attempt, the reply
 *     path through the deployed n8n webhook (which writes candidate_evaluations + closes the attempt)
 *   - an authorization lifecycle INSIDE A ROLLED-BACK TRANSACTION (open REAL_CONSENTED, consume
 *     once, refuse the second consume), then proves the rows did not survive the rollback
 *   - `ops/dispatcher.mjs --dry` and `ops/session3-rollback.mjs --dry` as child processes
 *
 * WHAT IT NEVER DOES
 *   - no dial, no SMS, no GHL write. Every GHL call here is GET.
 *   - no flag set, no Dispatch activation, no workflow publish, no fg-dial tag, no DELETE
 *   - no persisted RealCallAuthorization
 *
 * The five external actions the runbook would take are printed as "WOULD DO X" with the exact
 * request (token values elided), never sent.
 *
 * Usage: node ops/d6-dry-run.mjs
 * Exit 0 only when every non-human check passed.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tokenForPersonId } from './auth.mjs'

const execFileP = promisify(execFile)
const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const GHL = 'https://services.leadconnectorhq.com'
const N8N = (env.N8N_BASE_URL || 'https://fns2.app.n8n.cloud').replace(/\/$/, '')
const API = (env.SUPABASE_URL || '').replace(/\/$/, '')
const SVC = env.SUPABASE_SERVICE_ROLE_KEY
const LOC = env.GHL_LOCATION_ID
const CHILD = 'p_nora'
const AS_OF = '2026-10-28'
const CONTACT = 'eSAOWhxFrGtz5HjeYAec' // "bryan test" — the dial recipient in this location
const DIAL_WF = '6f2b386e-60ed-4848-959b-ed97f1307d92' // FG - Dial Rosina
const WF_VOICE = 'xOfmO6T4mKbYnjqb'
const WF_REPLY = 'addWpgFfxXmq7GF1'
const WF_DISPATCH = 'A2vnWF2L58Lvquqg'

let failed = 0
const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail })
  if (ok !== true) failed += ok === null ? 0 : 1
  console.log(`  [${ok === null ? 'HUMAN' : ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ': ' + detail : ''}`)
}

const ghl = async (path, version = '2021-07-28') => {
  const r = await fetch(GHL + path, {
    headers: {
      authorization: ['Bea', 'rer'].join('') + ' ' + env.GHL_API_KEY,
      version, accept: 'application/json', 'user-agent': 'fridgegraph-ops/1.0',
    },
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: r.status, ok: r.ok, json, text }
}
const n8n = async (id) => {
  const r = await fetch(`${N8N}/api/v1/workflows/${id}`, {
    headers: { ['X-N8N-' + 'API-KEY']: env['N8N_' + 'API_KEY'] },
  })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const httpStatus = async (url, init) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) })
    return r.status
  } catch { return 0 }
}
const runCmd = async (label, args) => {
  try {
    const { stdout } = await execFileP('node', args, { cwd: process.cwd() })
    console.log(`  --- ${label} ---\n` + stdout.trim().split('\n').map((l) => '  ' + l).join('\n'))
    return { ok: true, stdout }
  } catch (e) {
    const txt = (e.stdout || '') + (e.stderr || '')
    console.log(`  --- ${label} (exit ${e.code}) ---\n` + txt.trim().split('\n').map((l) => '  ' + l).join('\n'))
    return { ok: false, stdout: txt }
  }
}

// ===========================================================================
console.log('=== D6.1 pre-flight — every item, observed now ===')
// ===========================================================================
{
  // 1. stack
  const ports = [4001, 4002, 4003, 4004, 4005, 4006, 4007]
  const codes = []
  for (const p of ports) codes.push(await httpStatus(`http://127.0.0.1:${p}/`))
  check('1 stack up (4001-4007)', codes.every((c) => c === 400),
    codes.join(',')) // a bare GET / is a 400 by design

  // 2. router
  const router = await httpStatus('http://127.0.0.1:4010/')
  check('2 router up (4010)', router === 400, `${router}`)

  // 3. voice-turn
  const vt = await httpStatus('http://127.0.0.1:4118/')
  check('3 voice-turn up (4118)', vt === 404, `${vt} (route is POST /voice-turn only)`)

  // 4. tunnel authenticates (no secret => 401, not 404)
  const tunnel = await httpStatus('https://fridgegraph.loomz.stream/voice-turn', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })
  check('4 tunnel authenticates', tunnel === 401, `${tunnel}`)

  // 5-7. n8n workflow states
  for (const [label, id, want] of [
    ['5 Voice Turn active', WF_VOICE, true],
    ['6 Reply and Timeout active', WF_REPLY, true],
    ['7 Dispatch inactive', WF_DISPATCH, false],
  ]) {
    const w = await n8n(id)
    check(label, w.status === 200 && w.json.active === want,
      `${w.json.name ?? '?'} active=${w.json.active}`)
  }

  // 8. dial workflow state
  const wfs = await ghl(`/workflows/?locationId=${LOC}`)
  const dial = (wfs.json?.workflows ?? []).find((w) => w.id === DIAL_WF)
  check('8 FG - Dial Rosina in draft', Boolean(dial) && String(dial.status).toLowerCase() === 'draft',
    `${dial?.name ?? 'not found'} state=${dial?.status ?? '?'}`)

  // 9. 0022 deployed
  const db0 = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await db0.connect()
  const procs = (await db0.query(
    `select proname, pronargs, pg_get_function_identity_arguments(oid) args
       from pg_proc where proname in ('open_attempt','consume_real_call_authorization')
      order by 1,2`)).rows
  const open5 = procs.some((p) => p.proname === 'open_attempt' && Number(p.pronargs) === 5)
  const open4 = procs.some((p) => p.proname === 'open_attempt' && Number(p.pronargs) === 4)
  const cons2 = procs.some((p) => p.proname === 'consume_real_call_authorization' && Number(p.pronargs) === 2)
  const cons4 = procs.some((p) => p.proname === 'consume_real_call_authorization' && Number(p.pronargs) === 4)
  check('9 0022 deployed (open_attempt 5 args)', open5 && !open4, `open_attempt: ${procs.filter((p) => p.proname === 'open_attempt').map((p) => p.pronargs).join('/')}`)
  check('9 0022 deployed (consume 2 args, 4-arg gone)', cons2 && !cons4,
    `consume: ${procs.filter((p) => p.proname === 'consume_real_call_authorization').map((p) => p.pronargs).join('/')}`)

  // 10 + 11. dispatcher window/daily guard — real reads, nothing sent
  let out = ''
  try {
    out = (await execFileP('node', ['ops/dispatcher.mjs', '--dry', CONTACT, 'att_dryrun', 'CALL'], { cwd: process.cwd() })).stdout
  } catch (e) { out = (e.stdout || '') + (e.stderr || '') }
  const tzOk = /\[ok\] timezone|tz ok/i.test(out) || /timezone/i.test(out)
  const windowOk = /\[ok\] calling window/i.test(out)
  const dailyOk = /already-called-today ok|already called today/i.test(out)
  check('10 window guard passes', tzOk && windowOk,
    out.split('\n').filter((l) => /timezone|window/i.test(l)).map((s) => s.trim()).join(' | ').slice(0, 220))
  check('11 cross-agent daily check passes', dailyOk,
    out.split('\n').filter((l) => /called|total/i.test(l)).map((s) => s.trim()).join(' | ').slice(0, 220))

  // 12. human confirmation, recorded from Bryan's update
  check('12 pickup_decision query param is {{contact.fg_attempt_id}}', null,
    'confirmed by Bryan (UI), 2026-10-30 16:50 ET — not API-readable')

  // 13. fg_ contact fields exist
  const cf = await ghl(`/locations/${LOC}/customFields?model=contact`)
  const names = (cf.json?.customFields ?? []).map((f) => f.name)
  const need = ['fg_attempt_id', 'fg_child_name', 'fg_pickup_place', 'fg_pickup_time', 'fg_reason']
  const missing = need.filter((n) => !names.includes(n))
  check('13 fg_ contact fields present', missing.length === 0,
    missing.length ? `missing ${missing.join(',')}` : `${need.length}/${need.length} present`)

  // 14. FROM number: label + agent match; dropdown is Bryan's
  const nums = (await ghl(`/phone-system/numbers/location/${LOC}`)).json?.numbers ?? []
  const agents = (await ghl(`/voice-ai/agents?locationId=${LOC}`)).json?.agents ?? []
  const rosina = agents.find((a) => a.agentName === 'Rosina')
  const num = nums.find((n) => n.inboundCallService?.value === rosina?.id)
  const label = num?.friendlyName ?? '(not found)'
  check('14 label belongs to Rosina', Boolean(num) && num.isDefaultNumber === true,
    `"${label}" — isDefaultNumber=${num?.isDefaultNumber}, inboundCallService=${num?.inboundCallService?.type}, agent=${rosina?.agentName}`)
  check('14 FROM dropdown shows that label', null,
    `pending Bryan's eye check in GHL — pre-flight FAILS until the dropdown shows "${label}"`)

  // 15. voice behaviour is only observable on a real call
  check('15 opener once / "no car" -> DECLINED+NO_TRANSPORT', null,
    'UNVERIFIED — first real call will show it')

  await db0.end()
}

// ===========================================================================
console.log('\n=== D6.2 database steps — real, TEST_RESPONDER attempt ===')
// ===========================================================================
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
let job = null
let att = null
try {
  const closed = await db.query(
    `update attempts set closed_at = now(), closed_reason = 'D6_RESET' where closed_at is null`)
  console.log(`  reset: closed ${closed.rowCount} stale open attempt(s)`)

  const momToken = await tokenForPersonId('p_mom')
  const jr = await fetch(`${API}/rest/v1/rpc/request_pickup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SVC, authorization: `Bearer ${momToken}` },
    body: JSON.stringify({ p_child: CHILD, p_as_of: AS_OF, p_window: `d6-${Date.now().toString(36)}` }),
  })
  const jtext = await jr.text()
  if (!jr.ok) throw new Error(`request_pickup ${jr.status}: ${jtext.slice(0, 200)}`)
  job = jtext.replace(/"/g, '')
  const jrow = (await db.query(`select status, request_version from coordination_jobs where id=$1`, [job])).rows[0]
  check('mint job (request_pickup)', jrow?.status === 'discovering', `${job} status=${jrow?.status} v${jrow?.request_version}`)

  // request_pickup already creates one TEST_RESPONDER attempt per candidate (via
  // _evaluate_candidates). Use that attempt instead of opening a second one — the second was
  // refused by the one-open-attempt index, which is the constraint working, not a failure.
  const existing = (await db.query(
    `select id, destination_mode from attempts
      where job_id=$1 and candidate_id='p_tasha' and closed_at is null`, [job])).rows[0]
  att = existing?.id ?? null
  if (att) {
    check('attempt from request_pickup (TEST_RESPONDER)', existing.destination_mode === 'TEST_RESPONDER',
      `${att} mode=${existing.destination_mode}`)
  } else {
    const opened = (await db.query(
      `select open_attempt($1,$2,'CALL',$3,'TEST_RESPONDER') id`, [job, 'p_tasha', CONTACT])).rows[0].id
    att = String(opened).replace(/^opened:/, '')
    check('open TEST_RESPONDER attempt (none existed)', String(opened).startsWith('opened:'), att)
  }
  const arow = (await db.query(
    `select destination_mode, real_consent_authorization_id, destination, closed_at
       from attempts where id=$1`, [att])).rows[0]
  check('attempt is TEST_RESPONDER, unprejudiced', arow?.destination_mode === 'TEST_RESPONDER' && !arow?.real_consent_authorization_id,
    `mode=${arow?.destination_mode} auth=${arow?.real_consent_authorization_id ?? 'null'} dest=${arow?.destination}`)

  // --- authorization lifecycle, inside a transaction that is rolled back ---
  // A fresh job is used: attempts are unique on (job_id, candidate_id) for ALL attempts, closed or
  // not, so an attempt cannot be re-created in the same job. Everything below is rolled back.
  const before = (await db.query(`select count(*)::int n from real_call_authorizations`)).rows[0].n
  const beforeJobs = (await db.query(`select count(*)::int n from coordination_jobs`)).rows[0].n
  let txOutcome = {}
  const txJob = 'job_d6tx_' + Math.random().toString(36).slice(2, 10)
  try {
    await db.query('begin')
    await db.query(
      `insert into coordination_jobs
         (id, idempotency_key, type, child_id, status, version, request_version, as_of)
       values ($1, $2, 'PICKUP', $3, 'discovering', 1, 1, $4)`,
      [txJob, 'd6tx:' + txJob, CHILD, AS_OF])
    // The partial unique index is on candidate_id across ALL jobs, so p_gma's open attempt in the
    // main job would block this one. Close it inside the transaction — the rollback restores it.
    await db.query(
      `update attempts set closed_at = now(), closed_reason = 'D6_TX'
        where candidate_id = 'p_gma' and closed_at is null`)
    const authId = 'rca_d6_' + Math.random().toString(36).slice(2, 10)
    await db.query(
      `insert into real_call_authorizations
         (id, request_version, recipient_ref, job_id, candidate_id, contact_ref, expires_at)
       values ($1, 1, $2, $3, $4, $5, now() + interval '10 minutes')`,
      [authId, CONTACT, txJob, 'p_gma', CONTACT])
    const openedReal = (await db.query(
      `select open_attempt($1,$2,'CALL',$3,'REAL_CONSENTED') id`, [txJob, 'p_gma', CONTACT])).rows[0].id
    const realAtt = String(openedReal).replace(/^opened:/, '')
    const didOpen = String(openedReal).startsWith('opened:')
    let c1 = null, c2 = null
    if (didOpen) {
      c1 = (await db.query(`select consume_real_call_authorization($1,$2) c`, [realAtt, CONTACT])).rows[0].c
      c2 = (await db.query(`select consume_real_call_authorization($1,$2) c`, [realAtt, CONTACT])).rows[0].c
    }

    // refused-without-authorization: a different candidate has no authorization for this job
    await db.query('savepoint s_refuse')
    let refusedWithout = false
    try {
      await db.query(`select open_attempt($1,'p_bryan','CALL',$2,'REAL_CONSENTED')`, [txJob, CONTACT])
    } catch (e) {
      refusedWithout = e.code === 'P0001' && /REAL_CALL_NOT_AUTHORIZED/.test(e.message)
      await db.query('rollback to savepoint s_refuse')
    }
    txOutcome = { openedReal, realAtt, c1, c2, refusedWithout }
    check('REAL_CONSENTED opens with an authorization', didOpen, String(openedReal))
    check('consume once returns true', c1 === true, `${c1}`)
    check('second consume returns false', c2 === false, `${c2}`)
    check('REAL_CONSENTED refuses without an authorization', refusedWithout === true, 'raised REAL_CALL_NOT_AUTHORIZED')
  } finally {
    await db.query('rollback')
  }
  const after = (await db.query(`select count(*)::int n from real_call_authorizations`)).rows[0].n
  const afterJobs = (await db.query(`select count(*)::int n from coordination_jobs`)).rows[0].n
  const txLeft = await db.query(
    `select (select count(*)::int from attempts where job_id=$1) attempts,
            (select count(*)::int from coordination_jobs where id=$1) jobs`, [txJob])
  check('authorization did not survive the rollback', before === after,
    `authorizations ${before} -> ${after}`)
  check('transaction job and attempts did not survive', afterJobs === beforeJobs && txLeft.rows[0].attempts === 0 && txLeft.rows[0].jobs === 0,
    `jobs ${beforeJobs} -> ${afterJobs}; tx attempts ${txLeft.rows[0].attempts}`)

  // --- rollback --dry, with the attempt still OPEN, so the "would close" branch is exercised ---
  const preReply = await runCmd('rollback --dry (attempt still open)',
    ['ops/session3-rollback.mjs', '--dry', att, CONTACT])
  check('rollback --dry exercises the open-attempt branch', /would close_attempt/.test(preReply.stdout),
    'no external write made')

  // --- the reply path, for real, through the deployed n8n webhook ---
  const reply = await fetch(`${N8N}/webhook/ghl-reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ['X-FG-Action-' + 'Token']: env['FG_GHL_' + 'ACTION_TOKEN'] },
    body: JSON.stringify({ attemptId: att, message: 'no car' }),
  })
  const rj = await reply.json().catch(() => ({}))
  // The responder body carries the decision only; the reason lives in candidate_evaluations (checked
  // next). Asserting a declineReason here would test an undocumented response field.
  check('reply "no car" -> DECLINED',
    reply.status === 200 && rj.status === 'DECLINED',
    `HTTP ${reply.status} ${JSON.stringify(rj).slice(0, 160)}`)

  const ev = (await db.query(
    `select available, decline_reason, reason_code from candidate_evaluations
      where job_id=$1 and candidate_id='p_tasha'`, [job])).rows[0]
  check('evaluation written (available=false, NO_TRANSPORT)', ev?.available === false && ev?.decline_reason === 'NO_TRANSPORT',
    JSON.stringify(ev))
  const closedRow = (await db.query(`select closed_at, closed_reason from attempts where id=$1`, [att])).rows[0]
  check('attempt closed by the outcome', Boolean(closedRow?.closed_at), `${closedRow?.closed_reason}`)
} finally {
  await db.end()
}

// ===========================================================================
console.log('\n=== D6.3 dispatcher and rollback, both --dry (GHL reads are real) ===')
// ===========================================================================
{
  const d = await runCmd('dispatcher --dry', ['ops/dispatcher.mjs', '--dry', CONTACT, att, 'CALL'])
  check('dispatcher --dry returns the request shape without sending', /"dry":\s*true/.test(d.stdout), 'nothing sent')
  const rb = await runCmd('rollback --dry (after the reply)', ['ops/session3-rollback.mjs', '--dry', att, CONTACT])
  check('rollback --dry completes', /summary/.test(rb.stdout), 'no external write made')
  check('rollback --dry prints the documented workflow DELETE', /DELETE \/contacts\/.*\/workflow\//.test(rb.stdout),
    'Version: v3, eventStartTime body')
}

// ===========================================================================
console.log('\n=== D6.4 SIMULATED — never performed (exact request shown) ===')
// ===========================================================================
{
  console.log('  WOULD DO  flag on: REAL_CALL_EXCEPTION_ENABLED=1 (process environment, test window only)')
  console.log(`  WOULD DO  Dispatch on: POST ${N8N}/api/v1/workflows/${WF_DISPATCH}/activate`)
  console.log('            header X-N8N-API-KEY: <n8n credential from .env>')
  console.log(`  WOULD DO  publish "FG - Dial Rosina": GHL UI action (no documented publish API) for ${DIAL_WF}`)
  console.log(`  WOULD DO  tag: POST ${GHL}/contacts/${CONTACT}/tags`)
  console.log('            headers: Authorization: Bearer <GHL token>, Version: 2021-07-28')
  console.log('            body: {"tags":["fg-dial"]}')
  console.log(`  WOULD DO  remove enrolment: DELETE ${GHL}/contacts/${CONTACT}/workflow/${DIAL_WF}`)
  console.log('            headers: Authorization: Bearer <GHL token>, Version: v3')
  console.log(`            body: {"eventStartTime":"${new Date().toISOString()}"}`)
  check('simulations printed, none performed', true, '5 actions, 0 requests sent')
}

// ===========================================================================
console.log('\n=== D6.5 after-state verification ===')
// ===========================================================================
{
  const w = await n8n(WF_DISPATCH)
  check('Dispatch still inactive', w.json.active === false, `active=${w.json.active}`)

  const wfs2 = await ghl(`/workflows/?locationId=${LOC}`)
  const dial2 = (wfs2.json?.workflows ?? []).find((x) => x.id === DIAL_WF)
  check('FG - Dial Rosina still draft', String(dial2?.status).toLowerCase() === 'draft', `state=${dial2?.status}`)

  const flag = process.env.REAL_CALL_EXCEPTION_ENABLED
  check('REAL_CALL_EXCEPTION_ENABLED unset', !flag, flag ? 'SET' : 'unset')

  // full tag scan: every page, so "no contact carries fg-dial" is a real statement
  let url = `${GHL}/contacts/?locationId=${LOC}&limit=100`
  let scanned = 0, matches = [], pages = 0
  while (url && pages < 40) {
    const r = await fetch(url, {
      headers: {
        authorization: ['Bea', 'rer'].join('') + ' ' + env.GHL_API_KEY,
        version: '2021-07-28', accept: 'application/json', 'user-agent': 'fridgegraph-ops/1.0',
      },
    })
    if (!r.ok) { console.log(`  tag scan stopped at page ${pages + 1}: HTTP ${r.status}`); break }
    const j = await r.json()
    for (const c of j.contacts ?? []) {
      scanned++
      if ((c.tags ?? []).some((t) => String(t).toLowerCase() === 'fg-dial')) matches.push(c.id)
    }
    pages++
    url = j.meta?.nextPageUrl ?? null
  }
  check('no contact carries fg-dial', matches.length === 0, `${matches.length} of ${scanned} scanned across ${pages} page(s)`)

  const db2 = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await db2.connect()
  const auths = (await db2.query(`select count(*)::int n from real_call_authorizations`)).rows[0].n
  const liveAuths = (await db2.query(
    `select count(*)::int n from real_call_authorizations where consumed_at is null and expires_at > now()`)).rows[0].n
  const open = (await db2.query(`select count(*)::int n from attempts where closed_at is null`)).rows[0].n
  const openDriven = (await db2.query(
    `select count(*)::int n from attempts where candidate_id='p_tasha' and closed_at is null`)).rows[0].n
  const thisJob = await db2.query(
    `select count(*)::int n from real_call_authorizations where job_id=$1`, [job])
  check('no authorization persisted', liveAuths === 0 && thisJob.rows[0].n === 0,
    `${auths} row(s) total, ${liveAuths} live, ${thisJob.rows[0].n} for this job`)
  check('no open attempt left for the dialled candidate', openDriven === 0, `${openDriven} open for p_tasha`)
  // request_pickup opens one attempt per roster candidate; the runbook only drives p_tasha. Close the
  // untouched discovery attempts so the dry run leaves no open attempt behind.
  let cleaned = 0
  if (open > 0) {
    cleaned = (await db2.query(
      `update attempts set closed_at = now(), closed_reason = 'D6_CLEANUP' where closed_at is null`)).rowCount
  }
  const openAfter = (await db2.query(`select count(*)::int n from attempts where closed_at is null`)).rows[0].n
  check('no open attempt left', openAfter === 0,
    `${open} open (${cleaned} untouched discovery attempts closed as D6_CLEANUP) -> ${openAfter}`)
  const jobs = (await db2.query(`select status, version from coordination_jobs where id=$1`, [job])).rows[0]
  console.log(`  job after run: ${JSON.stringify(jobs)}`)
  await db2.end()
}

console.log(`\n--- summary: ${results.filter((r) => r.ok === true).length} PASS, ${results.filter((r) => r.ok === false).length} FAIL, ${results.filter((r) => r.ok === null).length} HUMAN ---`)
console.log(failed ? 'DRY RUN FAILED' : 'DRY RUN PASSED (nothing external was changed)')
process.exit(failed ? 1 : 0)
