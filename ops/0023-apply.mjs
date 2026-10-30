#!/usr/bin/env node
/** Applies 0023_promote_real_consented.sql (forward-only). Persists the migration only:
 *  no fixtures, no authorizations, no attempts. The dry run afterwards is the proof. */
import pg from 'pg'
import { readFileSync } from 'node:fs'
const env = readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2) }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '')
const sql = readFileSync('supabase/migrations/0023_promote_real_consented.sql', 'utf8')
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
await c.query(sql)
console.log('0023 applied')
const f = (await c.query(`select pg_get_function_arguments(p.oid) a
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='promote_attempt_to_real_consented'`)).rows
console.log('promote signature:', f.map((r) => r.a))
const grants = (await c.query(`select grantee, privilege_type
  from information_schema.routine_privileges
 where routine_name='promote_attempt_to_real_consented'`)).rows
console.log('grants:', grants.map((g) => `${g.grantee}:${g.privilege_type}`).join(', ') || '(none)')
await c.end()
