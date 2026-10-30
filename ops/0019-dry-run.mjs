#!/usr/bin/env node
/**
 * Dry run for 0019_transport_policy.sql.
 *
 * Applies the migration inside a transaction, checks both functions were replaced, then rolls
 * back. Hashes the two definitions before, after-apply and after-rollback: the final hash must
 * equal the original, which proves nothing persisted.
 *
 * Applies nothing. Never prints the connection string.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2) }
const url = row.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '')

const raw = readFileSync('supabase/migrations/0019_transport_policy.sql', 'utf8')
// Strip the file's own transaction control so it can run inside ours.
const body = raw.split('\n').filter((l) => !/^\s*(begin|commit);\s*$/.test(l)).join('\n')

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const hashOf = async () => {
  const q = await c.query(`
    select md5(string_agg(d, '|' order by d)) h from (
      select pg_get_functiondef(p.oid) d
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('_rank_and_advance','approve_pickup')
    ) s`)
  return q.rows[0].h
}

const before = await hashOf()
console.log('hash before      :', before)

await c.query('begin')
try {
  await c.query(body)
  const applied = await hashOf()
  console.log('hash after apply :', applied, applied !== before ? '(changed)' : '(UNCHANGED — problem)')

  const rank = await c.query(`
    select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='_rank_and_advance'`)
  const approve = await c.query(`
    select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='approve_pickup'`)
  const rd = rank.rows[0].d, ad = approve.rows[0].d

  console.log('rank has no cost gate      :', !/cost <= v_cap/.test(rd))
  console.log('rank writes null cost      :', /estimated_ride_cost_usd = null/.test(rd))
  console.log('rank defers in-limit ride  :', /no_driver_available/.test(rd))
  console.log('rank restricts to no-car   :', /not exists \(select 1 from vehicles/.test(rd))
  console.log('approve has ride guard     :', /OVER_LIMIT_NOT_RIDE_OPTION/.test(ad))
  console.log('approve keeps accept bit   :', /OVER_LIMIT_NOT_ACCEPTED/.test(ad))
} catch (e) {
  console.log('APPLY FAILED:', e.message)
  await c.query('rollback')
  await c.end()
  process.exit(1)
}

await c.query('rollback')
const after = await hashOf()
console.log('hash after rollback:', after, after === before ? '(restored ✓)' : '(NOT RESTORED — problem)')
await c.end()

if (after !== before) { console.log('DRY RUN FAILED: rollback did not restore original definitions'); process.exit(1) }
console.log('DRY RUN OK — nothing persisted')
