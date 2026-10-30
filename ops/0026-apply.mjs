#!/usr/bin/env node
/** Applies 0026_demo_guide_derived_reads.sql (forward-only). Persists the migration only. */
import pg from 'pg'
import { readFileSync } from 'node:fs'
const env = readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2) }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '')
const sql = readFileSync('supabase/migrations/0026_demo_guide_derived_reads.sql', 'utf8')
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
await c.query(sql)
console.log('0026 applied')
for (const fn of ['pickup_candidates_for', 'grant_holders_for']) {
  const def = (await c.query(`
    select pg_get_functiondef(p.oid) d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = $1`, [fn])).rows[0].d
  const acl = (await c.query(`
    select has_function_privilege('authenticated', p.oid, 'EXECUTE') ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = $1`, [fn])).rows[0].ok
  console.log(`${fn}: guide clause=${/is_demo_guide\(\)/.test(def)} authenticated EXECUTE=${acl}`)
}
await c.end()
