#!/usr/bin/env node
/**
 * ops/session3-arm.mjs — arm the single real call (Session 3).
 *
 * DEVIATION, recorded on purpose (Bryan approved "direct"): `request_pickup` mints the job and then
 * `_evaluate_candidates` inserts a TEST_RESPONDER attempt for EVERY eligible candidate. `attempts`
 * is unique on (job_id, candidate_id), so a REAL_CONSENTED attempt for the same candidate cannot be
 * opened in that job afterwards. This script therefore mints the job directly and writes the single
 * PENDING evaluation row that `_evaluate_candidates` would have written for p_gma (who does hold
 * pickup.request on p_nora), then opens the REAL_CONSENTED attempt. Everything else follows the
 * runbook. A mint path that takes destination_mode is a TODO in HANDOFF.
 *
 * Order is the safety property:
 *   1. job (pending, v1)
 *   2. one PENDING evaluation for the dialled candidate
 *   3. RealCallAuthorization bound to job + candidate + GHL contact
 *   4. open_attempt REAL_CONSENTED (raises without a valid authorization)
 *   5. consume_real_call_authorization -> MUST be true, or this exits non-zero
 *   6. job -> discovering, v2
 *
 * Prints ids only. Never prints a token, a key, or a phone number.
 * Usage: node ops/session3-arm.mjs
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const CONTACT = 'AxdxEKypElfgvw3Aagfd' // Loretta Brooks (demo)
const CANDIDATE = 'p_gma'              // Loretta Brooks, the person asked
const CHILD = 'p_nora'
const AS_OF = '2026-10-28'

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const out = {}
try {
  const open = (await db.query(`select count(*)::int n from attempts where closed_at is null`)).rows[0].n
  if (open !== 0) throw new Error(`PRECONDITION: ${open} open attempt(s) exist`)

  await db.query('begin')

  const job = 'job_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  await db.query(
    `insert into coordination_jobs
       (id, idempotency_key, type, child_id, status, version, request_version, as_of)
     values ($1, $2, 'PICKUP', $3, 'pending', 1, 1, $4)`,
    [job, `pickup:${CHILD}:${AS_OF}:session3-real`, CHILD, AS_OF])

  const ce = (await db.query(
    `insert into candidate_evaluations (id, job_id, request_version, candidate_id, reason_code)
     values ('ce_' || substr(md5($1 || $2), 1, 24), $1, 1, $2, 'PENDING')
     returning id`, [job, CANDIDATE])).rows[0].id

  // open_attempt() refuses a job that is not discovering. request_pickup flips the status AFTER its
  // bulk attempt insert; here the attempt is opened by open_attempt, so the flip comes first.
  await db.query(`update coordination_jobs set status='discovering', version=2 where id=$1`, [job])

  const auth = 'rca_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  await db.query(
    `insert into real_call_authorizations
       (id, request_version, recipient_ref, job_id, candidate_id, contact_ref, expires_at)
     values ($1, 1, $2, $3, $4, $5, now() + interval '15 minutes')`,
    [auth, CONTACT, job, CANDIDATE, CONTACT])

  const opened = (await db.query(
    `select open_attempt($1,$2,'CALL',$3,'REAL_CONSENTED') id`, [job, CANDIDATE, CONTACT])).rows[0].id
  if (!String(opened).startsWith('opened:')) throw new Error(`OPEN_ATTEMPT: ${opened}`)
  const att = String(opened).slice('opened:'.length)

  const consumed = (await db.query(
    `select consume_real_call_authorization($1,$2) c`, [att, CONTACT])).rows[0].c
  if (consumed !== true) throw new Error('CONSUME_FAILED — do not proceed')

  const row = (await db.query(
    `select a.id, a.destination_mode, a.destination, a.real_consent_authorization_id,
            a.real_consent_consumed_at, j.status, j.version, coalesce(c.consumed_at::text,'null') auth_consumed
       from attempts a
       join coordination_jobs j on j.id = a.job_id
       left join real_call_authorizations c on c.id = a.real_consent_authorization_id
      where a.id = $1`, [att])).rows[0]

  await db.query('commit')
  Object.assign(out, { job, ce, auth, att, row })
} catch (e) {
  await db.query('rollback').catch(() => {})
  console.log('ARM FAILED: ' + e.message)
  await db.end()
  process.exit(1)
}
await db.end()

console.log(JSON.stringify(out, null, 2))
console.log('ARMED — nothing outbound yet: no flag, Dispatch inactive, no tag.')
