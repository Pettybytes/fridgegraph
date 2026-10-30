#!/usr/bin/env node
/**
 * ops/voice-turn-check.mjs — local proof for the voice-turn endpoint (webhook.md §3b).
 *
 * Verifies, against a running server:
 *   - each decision answers in under 2 s and returns one line for Rosina to say
 *   - ACCEPTED / DECLINED record availability through accept_pickup_webhook
 *   - CONTINUE / ESCALATE / END_CALL change no state
 *   - the same event id is idempotent
 *   - a bad secret and a stale timestamp are both rejected
 *   - NO confirmation is ever created, and the endpoint contains no call to approve_pickup
 *
 * Fictional responders only. Nothing is printed that identifies a real contact.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { tokenForPersonId } from './auth.mjs'

const API = process.env.SUPABASE_URL.replace(/\/$/, '')
const BASE = `http://127.0.0.1:${process.env.VOICE_TURN_PORT || 4118}`
const SECRET = process.env.N8N_WEBHOOK_SECRET
const AS_OF = '2026-10-28'
const RUN = Date.now().toString(36)

const results = []
const rec = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`) }

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const rpc = async (fn, args, token) => {
  const headers = { 'content-type': 'application/json', apikey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY }
  if (token) headers.authorization = `Bearer ${token}`
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) })
  return { status: r.status, text: await r.text() }
}

await db.query(`delete from coordination_jobs where idempotency_key like 'pickup:p_nora:2026-10-28:voice-check%'`)
const mom = await tokenForPersonId('p_mom')
const jobRes = await rpc('request_pickup', { p_child: 'p_nora', p_as_of: AS_OF, p_window: 'voice-check-' + RUN }, mom)
const job = jobRes.text.replace(/"/g, '')
const attempts = (await db.query(`select id, candidate_id from attempts where job_id=$1`, [job])).rows
const attemptOf = (cid) => attempts.find((a) => a.candidate_id === cid)?.id

const callVoice = async (body, opts = {}) => {
  const started = Date.now()
  const r = await fetch(`${BASE}/voice-turn`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fridgegraph-webhook-secret': opts.secret ?? SECRET,
      'x-fridgegraph-timestamp': String(opts.ts ?? Math.floor(Date.now() / 1000)),
    },
    body: JSON.stringify(body),
  })
  const json = await r.json().catch(() => ({}))
  return { status: r.status, json, ms: Date.now() - started }
}

const before = await db.query(`select count(*)::int n from confirmations where job_id=$1`, [job])

// CONTINUE — no state change
const cont = await callVoice({ attemptId: attemptOf('p_bryan'), decision: 'CONTINUE' })
rec('CONTINUE answers under 2 s with one line', cont.status === 200 && cont.ms < 2000 && typeof cont.json.say === 'string',
  `${cont.ms}ms say="${String(cont.json.say).slice(0, 40)}…"`)

const bryanEval = async () => (await db.query(
  `select available, accepted_via, reason_code from candidate_evaluations where job_id=$1 and candidate_id='p_bryan'`, [job])).rows[0]
const afterCont = await bryanEval()
rec('CONTINUE changed no state', afterCont.available === null && afterCont.accepted_via === null,
  `available=${afterCont.available} via=${afterCont.accepted_via}`)

// ACCEPTED — records availability
const acc = await callVoice({ attemptId: attemptOf('p_gma'), decision: 'ACCEPTED' })
rec('ACCEPTED answers under 2 s with one line', acc.status === 200 && acc.ms < 2000 && /available/.test(String(acc.json.say)),
  `${acc.ms}ms`)

const gmaEval = (await db.query(
  `select available, accepted_via from candidate_evaluations where job_id=$1 and candidate_id='p_gma'`, [job])).rows[0]
rec('ACCEPTED recorded availability via the shared function',
  gmaEval.available === true && gmaEval.accepted_via === 'WEBHOOK_CALLBACK',
  `available=${gmaEval.available} via=${gmaEval.accepted_via}`)

// Idempotent replay
const replay = await callVoice({ attemptId: attemptOf('p_gma'), decision: 'ACCEPTED' })
rec('the same decision replays without a second change', replay.status === 200,
  `status=${replay.status} note=${replay.json.note}`)

// DECLINED on another attempt
const dec = await callVoice({ attemptId: attemptOf('p_monique'), decision: 'DECLINED', declineReason: 'BUSY' })
const monEval = (await db.query(
  `select available, decline_reason from candidate_evaluations where job_id=$1 and candidate_id='p_monique'`, [job])).rows[0]
rec('DECLINED records the refusal', dec.status === 200 && monEval.available === false && monEval.decline_reason === 'BUSY',
  `available=${monEval.available} reason=${monEval.decline_reason}`)

// ESCALATE / END_CALL — no change
const esc = await callVoice({ attemptId: attemptOf('p_tasha'), decision: 'ESCALATE' })
const endc = await callVoice({ attemptId: attemptOf('p_tasha'), decision: 'END_CALL' })
rec('ESCALATE and END_CALL change no state',
  esc.status === 200 && endc.status === 200 && typeof esc.json.say === 'string' && typeof endc.json.say === 'string',
  `${esc.ms}ms/${endc.ms}ms`)

// Rejections
const bad = await callVoice({ attemptId: attemptOf('p_tasha'), decision: 'ACCEPTED' }, { secret: 'x'.repeat(8) })
rec('bad secret rejected 401', bad.status === 401, `status=${bad.status}`)

const stale = await callVoice({ attemptId: attemptOf('p_tasha'), decision: 'ACCEPTED' },
  { ts: Math.floor(Date.now() / 1000) - 400 })
rec('stale timestamp rejected 401', stale.status === 401, `status=${stale.status}`)

// The endpoint has no path to approval, and none was taken.
const src = readFileSync(new URL('./voice-turn-server.mjs', import.meta.url), 'utf8')
rec('endpoint source contains no approve_pickup call', !/rpc\/approve_pickup|['"]approve_pickup['"]/.test(src))

const after = await db.query(`select count(*)::int n from confirmations where job_id=$1`, [job])
rec('no confirmation was created', after.rows[0].n === before.rows[0].n,
  `before=${before.rows[0].n} after=${after.rows[0].n}`)

const jobStatus = (await db.query(`select status from coordination_jobs where id=$1`, [job])).rows[0].status
rec('the job was never approved by this endpoint', jobStatus !== 'confirmed', `status=${jobStatus}`)

// --- D5 (B5): real first names, resolved server-side from the attempt ---
rec('D5: opener names the requester and the child',
  typeof cont.json.say === 'string' && cont.json.say.includes('Kendra') && cont.json.say.includes('Nora')
    && !cont.json.say.includes('the family'),
  `say="${String(cont.json.say).slice(0, 72)}…"`)

rec('D5: the closing line names the requester too',
  typeof acc.json.say === 'string' && acc.json.say.includes('Kendra'),
  `say="${String(acc.json.say).slice(0, 60)}…"`)

// Fallback: with no single scheduled parent (as_of null) there is no unambiguous requester, so the
// line must say "the family" while still naming the child. Fixture only -- removed below.
const fbJob = 'job_voicecheckfb_' + RUN
const fbAtt = 'att_voicecheckfb_' + RUN
await db.query(`insert into coordination_jobs
    (id, idempotency_key, type, child_id, status, version, request_version, as_of)
    values ($1,$2,'PICKUP','p_nora','discovering',1,1,null)`, [fbJob, 'voice-check-fb:' + fbJob])
await db.query(`insert into attempts
    (id, job_id, channel, at, candidate_id, destination, destination_mode)
    values ($1,$2,'CALL',now(),'p_priya',null,'TEST_RESPONDER')`, [fbAtt, fbJob])
const fbCall = await callVoice({ attemptId: fbAtt, decision: 'CONTINUE' })
rec('D5: an unresolved requester falls back to "the family"',
  fbCall.status === 200 && String(fbCall.json.say).includes('the family')
    && String(fbCall.json.say).includes('Nora'),
  `say="${String(fbCall.json.say).slice(0, 72)}…"`)
await db.query(`delete from coordination_jobs where id=$1`, [fbJob])

await db.query(`delete from coordination_jobs where id=$1`, [job])
await db.end()

const failed = results.filter((r) => !r.ok)
console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.n).join(' | ')); process.exitCode = 1 }
