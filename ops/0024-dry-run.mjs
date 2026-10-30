#!/usr/bin/env node
/**
 * ops/0024-dry-run.mjs — dry run for 0024_authority_model.sql (E1, four-fact authority).
 *
 * One transaction, rolled back. Probes:
 *   1. the widened check accepts 'guardian' and 'resident_adult', rejects an unknown role;
 *   2. a guardian is recognised by is_parent_of() and appears in parent_ids_of();
 *   3. a 'resident_adult' in the same household is NOT recognised and does not appear —
 *      residence alone grants nothing;
 *   4. both function bodies carry the widened IN-list;
 *   5. counts are unchanged after the rollback.
 *
 * The probe uses a real identity (queried, never hardcoded) so current_person() resolves.
 *
 * Usage: node ops/0024-dry-run.mjs
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
  members: (await db.query('select count(*)::int n from household_members')).rows[0].n,
  people: (await db.query('select count(*)::int n from people')).rows[0].n,
})
const before = await counts()

const CHILD = 'p_nora'
const HH = 'h_a'

console.log('=== 0024 dry run (rolled back) ===')
await db.query('begin')
try {
  // A person with an identity (so current_person() resolves) who is not already in h_a.
  const who = (await db.query(
    `select im.user_id, im.person_id, p.display_name
       from identity_map im join people p on p.id = im.person_id
      where im.person_id not in (select person_id from household_members where household_id = $1)
      order by im.person_id limit 1`, [HH])).rows[0]
  if (!who) throw new Error('no identity candidate outside h_a')

  await db.query(
    `insert into household_members (person_id, household_id, role) values ($1,$2,'guardian')`,
    [who.person_id, HH])
  check('check accepts role=guardian', true, `${who.person_id} (${who.display_name})`)

  await db.query(`update household_members set role='resident_adult' where person_id=$1 and household_id=$2`,
    [who.person_id, HH])
  check('check accepts role=resident_adult', true, who.person_id)

  await db.query('savepoint s')
  try {
    await db.query(`update household_members set role='cousin' where person_id=$1 and household_id=$2`,
      [who.person_id, HH])
    check('unknown role rejected', false, 'no error')
  } catch (e) {
    check('unknown role rejected', /household_members_role_check/.test(String(e.message)),
      String(e.message).slice(0, 80))
    await db.query('rollback to savepoint s')
  }

  // Act as that person.
  await db.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: who.user_id })])
  const acting = (await db.query('select current_person() p, auth.uid() u')).rows[0]
  check('claims resolve to the probe person', acting.p === who.person_id, `${acting.p}`)

  // As resident_adult: no authority.
  const raParent = (await db.query('select is_parent_of($1) r', [CHILD])).rows[0].r
  const raIds = (await db.query('select parent_ids_of($1) r', [CHILD])).rows[0].r
  check('resident_adult is NOT a parent', raParent === false, String(raParent))
  check('resident_adult is not in parent_ids_of', !raIds.includes(who.person_id), JSON.stringify(raIds))

  // As guardian: full authority.
  await db.query(`update household_members set role='guardian' where person_id=$1 and household_id=$2`,
    [who.person_id, HH])
  const gParent = (await db.query('select is_parent_of($1) r', [CHILD])).rows[0].r
  const gIds = (await db.query('select parent_ids_of($1) r', [CHILD])).rows[0].r
  check('guardian IS a parent', gParent === true, String(gParent))
  check('guardian appears in parent_ids_of', gIds.includes(who.person_id), JSON.stringify(gIds))

  // Function bodies carry the widening.
  for (const fn of ['is_parent_of', 'parent_ids_of']) {
    const def = (await db.query(`select pg_get_functiondef($1::regproc) d`, [fn])).rows[0].d
    check(`${fn} uses the widened role list`, /role in \('parent', 'guardian'\)/.test(def),
      def.match(/role in \([^)]*\)/)?.[0] ?? 'not found')
  }
} finally {
  await db.query('rollback')
}

const after = await counts()
check('rolled back: household_members unchanged', before.members === after.members, `${before.members} -> ${after.members}`)
check('rolled back: people unchanged', before.people === after.people, `${before.people} -> ${after.people}`)

await db.end()
console.log(failed ? `\nDRY RUN FAILED: ${failed}` : '\nDRY RUN PASSED')
process.exit(failed ? 1 : 0)
