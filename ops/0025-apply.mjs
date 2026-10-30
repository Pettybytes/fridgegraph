#!/usr/bin/env node
/** Applies 0025_demo_sandbox.sql (forward-only). Persists the migration only. */
import pg from 'pg'
import { readFileSync } from 'node:fs'
const env = readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2) }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '')
const sql = readFileSync('supabase/migrations/0025_demo_sandbox.sql', 'utf8')
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
await c.query(sql)
console.log('0025 applied')

const checks = [
  ['markers', `select is_demo_caller() demo, is_demo_guide() guide`],
  ['job columns', `select column_name from information_schema.columns
     where table_schema='public' and table_name='coordination_jobs'
       and column_name in ('sandbox','demo_caller') order by column_name`],
  ['attempt columns', `select column_name from information_schema.columns
     where table_schema='public' and table_name='attempts'
       and column_name in ('sandbox','demo_caller') order by column_name`],
  ['guide policies', `select count(*)::int n from pg_policies
     where schemaname='public' and policyname like 'demo_guide_%'`],
  ['guide no-write policies', `select count(*)::int n from pg_policies
     where schemaname='public' and policyname like '%_guide_no_%'`],
  ['triggers', `select tgname from pg_trigger
     where not tgisinternal and tgname in
       ('coordination_jobs_mark_demo_caller','attempts_inherit_markers',
        'attempts_refuse_demo_promotion','real_call_authorizations_refuse_demo')
     order by tgname`],
  ['guide person row', `select id, display_name from people where id = 'p_demo_guide'`],
  ['sandbox households', `select count(*)::int n from households where sandbox`],
]
for (const [label, q] of checks) {
  const r = await c.query(q)
  console.log(`${label}:`, JSON.stringify(r.rows))
}
await c.end()
