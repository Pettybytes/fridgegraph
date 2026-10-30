#!/usr/bin/env node
/**
 * ops/0023-dry-run.mjs — dry run for 0023_promote_real_consented.sql.
 *
 * Everything happens inside ONE transaction that is rolled back. Fixtures are created in the
 * transaction, so nothing survives: the script asserts the before/after counts of jobs, attempts and
 * authorizations.
 *
 * Cases:
 *   1  args required
 *   2  unknown attempt
 *   3  promotion without an authorization is refused
 *   4  an authorization bound to another recipient is refused
 *   5  a request-version mismatch is refused
 *   6  valid promotion: mode flips, destination becomes the contact, authorization attached —
 *      and it is NOT consumed (the whole point of E0)
 *   7  promoting twice is refused
 *   8  promoting a closed attempt is refused
 *   9  dispatch consumes exactly once (true, then false) — the single consumption point
 *
 * Usage: node ops/0023-dry-run.mjs
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`)
}

const counts = async () => ({
  jobs: (await db.query('select count(*)::int n from coordination_jobs')).rows[0].n,
  attempts: (await db.query('select count(*)::int n from attempts')).rows[0].n,
  auths: (await db.query('select count(*)::int n from real_call_authorizations')).rows[0].n,
  evals: (await db.query('select count(*)::int n from candidate_evaluations')).rows[0].n,
})
const before = await counts()

const run = 'r' + Date.now().toString(36)
const contactA = 'ghl_contact_A_' + run
const contactB = 'ghl_contact_B_' + run

let seq = 0
// The partial unique index allows ONE open attempt per candidate across ALL jobs, so each fixture
// needs its own person. Read real ids instead of inventing them (FK + roster).
const PEOPLE = (await db.query('select id from people order by id limit 30')).rows.map((r) => r.id)
async function fixture({ contact = contactA, candidate = null, mode = 'TEST_RESPONDER', closed = false, rv = 1, auth = true, authContact = contact, authRv = null } = {}) {
  const job = `job_d23_${run}_${++seq}`
  const person = candidate ?? PEOPLE[seq % PEOPLE.length]
  await db.query(
    `insert into coordination_jobs (id, idempotency_key, type, child_id, status, version, request_version, as_of)
     values ($1, $2, 'PICKUP', 'p_nora', 'discovering', 2, $3, '2026-10-28')`,
    [job, 'd23:' + job, rv])
  const att = `att_d23_${run}_${seq}`
  await db.query(
    `insert into attempts (id, job_id, channel, at, candidate_id, destination, destination_mode, closed_at, closed_reason)
     values ($1, $2, 'CALL', now(), $3, 'test-dest', $4, $5, $6)`,
    [att, job, person, mode, closed ? new Date() : null, closed ? 'D23_FIXTURE' : null])
  await db.query(
    `insert into candidate_evaluations (id, job_id, request_version, candidate_id, reason_code)
     values ('ce_' || substr(md5($1 || $2), 1, 24), $1, $3, $2, 'PENDING')`,
    [job, person, rv])
  let authId = null
  if (auth) {
    authId = `rca_d23_${run}_${seq}`
    await db.query(
      `insert into real_call_authorizations
         (id, request_version, recipient_ref, job_id, candidate_id, contact_ref, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + interval '10 minutes')`,
      [authId, authRv ?? rv, authContact, job, person, authContact])
  }
  return { job, att, auth: authId, person }
}

const promote = async (att, contact) =>
  (await db.query('select promote_attempt_to_real_consented($1,$2) r', [att, contact])).rows[0].r

/** Expected failure inside a savepoint, so the transaction stays usable. */
async function expectRaise(label, fn, needle) {
  await db.query('savepoint s')
  try {
    await fn()
    check(label, false, 'no error raised')
    await db.query('rollback to savepoint s')
  } catch (e) {
    check(label, String(e.message).includes(needle), String(e.message).slice(0, 90))
    await db.query('rollback to savepoint s')
  }
}

console.log('=== 0023 dry run (all inside one rolled-back transaction) ===')
await db.query('begin')
try {
  // 1 args
  await expectRaise('args required', () => db.query('select promote_attempt_to_real_consented(null,$1)', [contactA]), 'PROMOTE_ARGS_REQUIRED')
  await expectRaise('contact required', () => db.query('select promote_attempt_to_real_consented($1,\'\')', ['att_x']), 'PROMOTE_ARGS_REQUIRED')

  // 2 unknown
  await expectRaise('unknown attempt', () => promote('att_nope', contactA), 'ATTEMPT_NOT_FOUND')

  // 3 no authorization
  const f3 = await fixture({ auth: false })
  await expectRaise('promotion without an authorization is refused',
    () => promote(f3.att, contactA), 'REAL_CALL_NOT_AUTHORIZED')
  {
    const a = (await db.query('select destination_mode from attempts where id=$1', [f3.att])).rows[0]
    check('refused promotion left the attempt TEST_RESPONDER', a.destination_mode === 'TEST_RESPONDER', a.destination_mode)
  }

  // 4 wrong recipient
  const f4 = await fixture({ authContact: contactA })
  await expectRaise('an authorization for another recipient is refused',
    () => promote(f4.att, contactB), 'REAL_CALL_NOT_AUTHORIZED')

  // 5 request-version mismatch
  const f5 = await fixture({ rv: 1, authRv: 2 })
  await expectRaise('a request-version mismatch is refused',
    () => promote(f5.att, contactA), 'REAL_CALL_NOT_AUTHORIZED')

  // 6 valid promotion
  const f6 = await fixture({})
  {
    const r = await promote(f6.att, contactA)
    check('valid promotion returns promoted:<attempt>', r === 'promoted:' + f6.att, r)
    const a = (await db.query(
      `select destination_mode, destination, real_consent_authorization_id, real_consent_consumed_at
         from attempts where id=$1`, [f6.att])).rows[0]
    check('mode is REAL_CONSENTED', a.destination_mode === 'REAL_CONSENTED', a.destination_mode)
    check('destination is the GHL contact', a.destination === contactA, a.destination)
    check('authorization attached to the attempt', a.real_consent_authorization_id === f6.auth, a.real_consent_authorization_id)
    const au = (await db.query(
      `select attempt_id, consumed_at from real_call_authorizations where id=$1`, [f6.auth])).rows[0]
    check('authorization points at the attempt', au.attempt_id === f6.att, au.attempt_id)
    check('PROMOTION DID NOT CONSUME', au.consumed_at === null, String(au.consumed_at))

    // 7 double
    await expectRaise('promoting twice is refused', () => promote(f6.att, contactA), 'ALREADY_REAL_CONSENTED')

    // 9 dispatch consumes once
    const c1 = (await db.query('select consume_real_call_authorization($1,$2) c', [f6.att, contactA])).rows[0].c
    const c2 = (await db.query('select consume_real_call_authorization($1,$2) c', [f6.att, contactA])).rows[0].c
    check('dispatch consumes exactly once (first true)', c1 === true, String(c1))
    check('second consumption is refused', c2 === false, String(c2))
    const au2 = (await db.query('select consumed_at from real_call_authorizations where id=$1', [f6.auth])).rows[0]
    check('authorization is consumed only after the dispatch call', au2.consumed_at !== null, String(au2.consumed_at))
  }

  // 8 closed attempt
  const f8 = await fixture({ closed: true })
  await expectRaise('promoting a closed attempt is refused', () => promote(f8.att, contactA), 'ATTEMPT_CLOSED')

  // wrong mode
  const f9 = await fixture({ mode: 'REAL_CONSENTED', auth: true })
  await expectRaise('an already-real attempt is refused', () => promote(f9.att, contactA), 'ALREADY_REAL_CONSENTED')
} finally {
  await db.query('rollback')
}

const after = await counts()
check('transaction rolled back: jobs unchanged', before.jobs === after.jobs, `${before.jobs} -> ${after.jobs}`)
check('transaction rolled back: attempts unchanged', before.attempts === after.attempts, `${before.attempts} -> ${after.attempts}`)
check('transaction rolled back: authorizations unchanged', before.auths === after.auths, `${before.auths} -> ${after.auths}`)
check('transaction rolled back: evaluations unchanged', before.evals === after.evals, `${before.evals} -> ${after.evals}`)

await db.end()
console.log(failed ? `\nDRY RUN FAILED: ${failed} check(s)` : '\nDRY RUN PASSED')
process.exit(failed ? 1 : 0)
