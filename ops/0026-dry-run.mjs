#!/usr/bin/env node
/**
 * ops/0026-dry-run.mjs — dry run for 0026_demo_guide_derived_reads.sql.
 *
 * One transaction: the migration SQL is applied inside it, the helpers are probed as three callers,
 * then everything is rolled back.
 *
 * Probes:
 *   A. a parent still gets exactly what they got before (unchanged)
 *   B. the guide gets the SAME candidate rows as the parent (the seam that was empty)
 *   C. an unrelated adult still gets nothing
 *   D. the guide gets nothing for a NON-sandbox child (the marker alone is not enough)
 *   E. grant_holders_for follows the same rule
 *   F. the EXECUTE grants are untouched
 *   G. rolled back: the deployed function does not contain the new clause
 *
 * Usage: node ops/0026-dry-run.mjs
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const MAP = JSON.parse(readFileSync('data/identity-map.json', 'utf8'))
const userFor = (p) => Object.entries(MAP).find(([, v]) => v === p)?.[0]

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`)
}
const actAs = (sub, metadata = {}) =>
  db.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub, role: 'authenticated', app_metadata: metadata })])

const KENDRA = userFor('p_mom')
const DANA = userFor('p_dana')
const GUIDE = userFor('p_demo_guide')
for (const [n, v] of [['kendra', KENDRA], ['dana', DANA], ['guide', GUIDE]]) {
  if (!v) throw new Error(`identity map has no ${n}`)
}

const CHILD = 'p_nora'
const AS_OF = '2026-10-26'
const candidates = async () =>
  (await db.query('select from_id, type from pickup_candidates_for($1, $2) order by from_id, type',
    [CHILD, AS_OF])).rows
const holders = async (scope) =>
  (await db.query('select coalesce(array_to_string(grant_holders_for($1,$2,$3), \',\'), \'\') h',
    [CHILD, scope, AS_OF])).rows[0].h

const raw = readFileSync('supabase/migrations/0026_demo_guide_derived_reads.sql', 'utf8')
const body = raw.slice(raw.search(/^begin;/im) + 'begin;'.length, raw.lastIndexOf('commit;'))

console.log('=== 0026 dry run (migration applied inside one transaction, then rolled back) ===')
await db.query('begin')
try {
  // Baseline BEFORE the migration, as a parent.
  await actAs(KENDRA, {})
  const parentBefore = await candidates()

  await db.query(body)
  console.log('  migration SQL applied inside the transaction')

  // A. parent unchanged
  await actAs(KENDRA, {})
  const parentAfter = await candidates()
  check('A a parent gets the same rows as before the migration',
    JSON.stringify(parentBefore) === JSON.stringify(parentAfter),
    `${parentBefore.length} -> ${parentAfter.length} row(s)`)
  check('A the parent baseline is non-empty (otherwise nothing is proven)',
    parentAfter.length > 0, `${parentAfter.length} row(s)`)

  // B. guide == parent
  await actAs(GUIDE, { demo: true, demo_guide: true })
  const guideRows = await candidates()
  check('B the guide gets the same candidate rows as the parent',
    JSON.stringify(guideRows) === JSON.stringify(parentAfter),
    `${guideRows.length} vs ${parentAfter.length}`)

  // C. unrelated adult
  await actAs(DANA, { demo: true })
  const danaRows = await candidates()
  check('C an unrelated adult still gets nothing', danaRows.length === 0, `${danaRows.length} row(s)`)

  // D. non-sandbox child
  await db.query(`update households set sandbox = false
                   where id in (select household_id from household_members where person_id = $1)`,
    [CHILD])
  await actAs(GUIDE, { demo: true, demo_guide: true })
  const guideNonSandbox = await candidates()
  check('D the guide gets nothing for a non-sandbox child', guideNonSandbox.length === 0,
    `${guideNonSandbox.length} row(s)`)
  await db.query('savepoint restore_sandbox')
  await db.query(`update households set sandbox = true
                   where id in (select household_id from household_members where person_id = $1)`,
    [CHILD])
  await db.query('release savepoint restore_sandbox')

  // E. grant_holders_for
  await actAs(KENDRA, {})
  const parentHolders = await holders('pickup.request')
  await actAs(GUIDE, { demo: true, demo_guide: true })
  const guideHolders = await holders('pickup.request')
  await actAs(DANA, { demo: true })
  const danaHolders = await holders('pickup.request')
  check('E the guide sees the same grant holders as the parent', guideHolders === parentHolders,
    `${guideHolders.split(',').filter(Boolean).length} vs ${parentHolders.split(',').filter(Boolean).length}`)
  check('E an unrelated adult sees no grant holders', danaHolders === '', danaHolders || '(empty)')

  // F. EXECUTE grants
  const acl = (await db.query(`
    select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('pickup_candidates_for','grant_holders_for')
    order by p.proname`)).rows
  check('F authenticated keeps EXECUTE on both helpers',
    acl.length === 2 && acl.every((r) => r.ok === true),
    acl.map((r) => `${r.proname}=${r.ok}`).join(','))
} finally {
  await db.query('rollback')
}

// G. rolled back
const deployed = (await db.query(`
  select pg_get_functiondef(p.oid) d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'pickup_candidates_for'`)).rows[0].d
check('G rolled back: the deployed function does not contain the guide clause',
  !/is_demo_guide\(\)/.test(deployed))
const sandboxBack = (await db.query('select count(*)::int n from households where not sandbox')).rows[0].n
check('G rolled back: households sandbox flags restored', sandboxBack === 0, `${sandboxBack} non-sandbox`)

await db.end()
console.log(failed ? `\nDRY RUN FAILED: ${failed}` : '\nDRY RUN PASSED')
process.exit(failed ? 1 : 0)
