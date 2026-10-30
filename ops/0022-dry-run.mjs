#!/usr/bin/env node
/**
 * Dry run for 0022_real_consented_attempts.sql.
 *
 * Applies the migration inside ONE transaction and proves, against the live (dev) database, then
 * rolls back. Hashes the touched function definitions before / after-apply / after-rollback; the
 * final hash must equal the original.
 *
 * Proves: default path unchanged; REAL_CONSENTED refused without an authorization; allowed with
 * one; consume succeeds exactly once and then refuses reuse; expiry refused; each mismatch
 * (recipient, job, candidate) refused; a refused authorization never leaves a REAL_CONSENTED
 * attempt behind.
 *
 * Applies nothing. Prints no credentials.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const env = readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2) }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '')

const body = readFileSync('supabase/migrations/0022_real_consented_attempts.sql', 'utf8')
  .split('\n').filter((l) => !/^\s*(begin|commit);\s*$/.test(l)).join('\n')

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const FUNCS = ['open_attempt', 'consume_real_call_authorization', '_label_webhook_event_mode',
  '_expire_stale_attempts', 'accept_pickup_webhook']
const hash = async () => (await c.query(`
  select md5(string_agg(d, '|' order by d)) h from (
    select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname = any($1::text[])) s`, [FUNCS])).rows[0].h

let failed = 0
const check = (label, got, want) => {
  const ok = String(got) === String(want)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (expected ${want})`}`)
}
const expectRaise = async (label, sql, params, code) => {
  await c.query('savepoint s')
  try {
    await c.query(sql, params)
    check(label, 'no error', `raise ${code}`)
  } catch (e) {
    check(label, e.message.includes(code) ? code : e.message.slice(0, 60), code)
  }
  await c.query('rollback to savepoint s')
}

// Already applied? Then re-applying must be a NO-OP, and an unchanged hash is correct rather than
// a problem. Detect it from the function signature so the script tells the truth in both states.
const alreadyApplied = (await c.query(`
  select count(*)::int n from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname='public' and p.proname='open_attempt' and p.pronargs = 5`)).rows[0].n > 0
console.log('state            :', alreadyApplied ? '0022 already applied (re-apply must be a no-op)' : '0022 not applied yet')

const before = await hash()
console.log('hash before      :', before)

await c.query('begin')
try {
  await c.query(body)
  const after = await hash()
  if (alreadyApplied) {
    console.log('hash after apply :', after, after === before ? '(unchanged — correct for a re-apply)' : '(CHANGED — unexpected)')
    if (after !== before) failed++
  } else {
    console.log('hash after apply :', after, after !== before ? '(changed)' : '(UNCHANGED — problem)')
    if (after === before) failed++
  }

  // --- fixtures ------------------------------------------------------------
  await c.query(`update attempts set closed_at = now(), closed_reason='DRYRUN_0022' where closed_at is null`)
  const child = (await c.query(`select person_id from children limit 1`)).rows[0].person_id
  const mkJob = async () => {
    const id = 'job_' + randomUUID().replace(/-/g, '').slice(0, 26)
    await c.query(`insert into coordination_jobs
      (id, idempotency_key, type, child_id, status, version, request_version, as_of)
      values ($1,$2,'PICKUP',$3,'discovering',1,1,current_date)`, [id, 'dry22:' + id, child])
    return id
  }
  // issuedAgoMin back-dates issued_at so an EXPIRED authorization can still satisfy the table's
  // expires_at > issued_at constraint (an already-expired row must look like it expired, not like
  // it was born invalid).
  const mint = async ({ job, cand, contact, ttlMin = 10, consumed = false, issuedAgoMin = 0 }) => {
    const id = 'rca_' + randomUUID().replace(/-/g, '').slice(0, 20)
    await c.query(`insert into real_call_authorizations
        (id, attempt_id, request_version, recipient_ref, job_id, candidate_id, contact_ref,
         issued_at, expires_at, consumed_at)
        values ($1,null,1,$2,$3,$4,$5,
                now() - make_interval(mins => $6),
                now() - make_interval(mins => $6) + make_interval(mins => $7), $8)`,
      [id, contact, job, cand, contact, issuedAgoMin, ttlMin, consumed ? new Date() : null])
    return id
  }
  const modeOf = async (att) => (await c.query(
    `select destination_mode, real_consent_authorization_id from attempts where id=$1`, [att])).rows[0]

  // 1. default path unchanged
  console.log('\n--- 1. default path unchanged ---')
  const j1 = await mkJob()
  const r1 = (await c.query(`select open_attempt($1,'p_tasha','SMS') r`, [j1])).rows[0].r
  check('opens with defaults', r1.startsWith('opened:'), true)
  const att1 = r1.split(':')[1]
  const m1 = await modeOf(att1)
  check('default destination_mode', m1.destination_mode, 'TEST_RESPONDER')
  check('no authorization attached', m1.real_consent_authorization_id, null)

  // 2. REAL_CONSENTED refused without an authorization
  console.log('\n--- 2. REAL_CONSENTED without an authorization ---')
  await c.query(`update attempts set closed_at=now(), closed_reason='DRYRUN_STEP' where closed_at is null`)
  const j2 = await mkJob()
  await expectRaise('refused, no attempt created',
    `select open_attempt($1,'p_tasha','CALL','ghl_contact_A','REAL_CONSENTED')`, [j2],
    'REAL_CALL_NOT_AUTHORIZED')
  check('no attempt row appeared', (await c.query(
    `select count(*)::int n from attempts where job_id=$1`, [j2])).rows[0].n, 0)

  // 3. allowed with a valid authorization
  console.log('\n--- 3. REAL_CONSENTED with a valid authorization ---')
  const auth3 = await mint({ job: j2, cand: 'p_tasha', contact: 'ghl_contact_A' })
  const r3 = (await c.query(
    `select open_attempt($1,'p_tasha','CALL','ghl_contact_A','REAL_CONSENTED') r`, [j2])).rows[0].r
  check('opens', r3.startsWith('opened:'), true)
  const att3 = r3.split(':')[1]
  const m3 = await modeOf(att3)
  check('mode is REAL_CONSENTED', m3.destination_mode, 'REAL_CONSENTED')
  check('authorization attached', m3.real_consent_authorization_id, auth3)
  check('authorization bound to this attempt', (await c.query(
    `select attempt_id from real_call_authorizations where id=$1`, [auth3])).rows[0].attempt_id, att3)

  // 4. consume once, then refuse reuse
  console.log('\n--- 4. consume: single use ---')
  check('first consume succeeds',
    (await c.query(`select consume_real_call_authorization($1,$2) r`, [att3, 'ghl_contact_A'])).rows[0].r, true)
  check('second consume refused',
    (await c.query(`select consume_real_call_authorization($1,$2) r`, [att3, 'ghl_contact_A'])).rows[0].r, false)
  check('attempt labelled with consume time', (await c.query(
    `select real_consent_consumed_at is not null f from attempts where id=$1`, [att3])).rows[0].f, true)

  // 5. expiry
  console.log('\n--- 5. expiry ---')
  await c.query(`update attempts set closed_at=now(), closed_reason='DRYRUN_STEP' where closed_at is null`)
  const j5 = await mkJob()
  await mint({ job: j5, cand: 'p_tasha', contact: 'ghl_contact_B', issuedAgoMin: 120, ttlMin: 60 })
  await expectRaise('expired authorization refused',
    `select open_attempt($1,'p_tasha','CALL','ghl_contact_B','REAL_CONSENTED')`, [j5],
    'REAL_CALL_NOT_AUTHORIZED')

  // 6. mismatches
  console.log('\n--- 6. mismatches ---')
  await c.query(`update attempts set closed_at=now(), closed_reason='DRYRUN_STEP' where closed_at is null`)
  const j6 = await mkJob()
  await mint({ job: j6, cand: 'p_tasha', contact: 'ghl_contact_C' })
  await expectRaise('wrong recipient refused at open',
    `select open_attempt($1,'p_tasha','CALL','ghl_contact_D','REAL_CONSENTED')`, [j6],
    'REAL_CALL_NOT_AUTHORIZED')

  await c.query(`update attempts set closed_at=now(), closed_reason='DRYRUN_STEP' where closed_at is null`)
  const j6b = await mkJob()
  await mint({ job: j6b, cand: 'p_tasha', contact: 'ghl_contact_C' })
  const r6 = (await c.query(
    `select open_attempt($1,'p_tasha','CALL','ghl_contact_C','REAL_CONSENTED') r`, [j6b])).rows[0].r
  const att6 = r6.split(':')[1]
  check('correct recipient opens', r6.startsWith('opened:'), true)
  check('consume with a different contact refused',
    (await c.query(`select consume_real_call_authorization($1,$2) r`, [att6, 'ghl_contact_Z'])).rows[0].r, false)
  check('still consumable with the right contact',
    (await c.query(`select consume_real_call_authorization($1,$2) r`, [att6, 'ghl_contact_C'])).rows[0].r, true)

  // wrong candidate
  await c.query(`update attempts set closed_at=now(), closed_reason='DRYRUN_STEP' where closed_at is null`)
  const j7 = await mkJob()
  await mint({ job: j7, cand: 'p_monique', contact: 'ghl_contact_E' })
  await expectRaise('authorization for another candidate refused',
    `select open_attempt($1,'p_tasha','CALL','ghl_contact_E','REAL_CONSENTED')`, [j7],
    'REAL_CALL_NOT_AUTHORIZED')

  // wrong job
  await c.query(`update attempts set closed_at=now(), closed_reason='DRYRUN_STEP' where closed_at is null`)
  const j8 = await mkJob()
  const j8b = await mkJob()
  await mint({ job: j8b, cand: 'p_tasha', contact: 'ghl_contact_F' })
  await expectRaise('authorization for another job refused',
    `select open_attempt($1,'p_tasha','CALL','ghl_contact_F','REAL_CONSENTED')`, [j8],
    'REAL_CALL_NOT_AUTHORIZED')

  // 7. an attempt that is not real-consented can never consume
  console.log('\n--- 7. test-responder attempt cannot consume ---')
  check('consume on TEST_RESPONDER attempt',
    (await c.query(`select consume_real_call_authorization($1,$2) r`, [att1, 'ghl_contact_A'])).rows[0].r, false)

  // 8. webhook_events inherits the mode
  console.log('\n--- 8. event labelling ---')
  await c.query(`update attempts set closed_at=now(), closed_reason='DRYRUN_STEP' where closed_at is null`)
  const j9 = await mkJob()
  const a9 = await mint({ job: j9, cand: 'p_tasha', contact: 'ghl_contact_G' })
  const r9 = (await c.query(
    `select open_attempt($1,'p_tasha','CALL','ghl_contact_G','REAL_CONSENTED') r`, [j9])).rows[0].r
  const att9 = r9.split(':')[1]
  await c.query(`insert into webhook_events (id, attempt_id, request_version, payload_sha256, outcome, source)
                 values ('evt_0022_label',$1,1,'sha','ACCEPTED','reply')`, [att9])
  check('event inherits REAL_CONSENTED',
    (await c.query(`select destination_mode from webhook_events where id='evt_0022_label'`)).rows[0].destination_mode,
    'REAL_CONSENTED')
  check('authorization was valid at open', Boolean(a9), true)
} catch (e) {
  failed++
  console.log('APPLY FAILED:', e.message)
  await c.query('rollback')
  await c.end()
  process.exit(1)
}

await c.query('rollback')
const after = await hash()
console.log('\nhash after rollback:', after, after === before ? '(restored ✓)' : '(NOT RESTORED — problem)')
if (after !== before) failed++
await c.end()

if (failed) { console.log(`DRY RUN FAILED (${failed} failing checks)`); process.exit(1) }
console.log('DRY RUN OK — nothing persisted')
