#!/usr/bin/env node
/** Applies 0022_real_consented_attempts.sql (forward-only). Persists the migration only:
 *  no fixtures, no authorizations, no attempts. Run the dry run afterwards for the post-apply proof. */
import pg from 'pg'
import { readFileSync } from 'node:fs'
const env = readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2) }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '')
const sql = readFileSync('supabase/migrations/0022_real_consented_attempts.sql', 'utf8')
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
await c.query(sql)
console.log('0022 applied')
const oa = (await c.query(`select pg_get_function_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='open_attempt'`)).rows
console.log('open_attempt signatures:', oa.map((r) => r.a))
const co = (await c.query(`select pg_get_function_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='consume_real_call_authorization'`)).rows
console.log('consume signatures   :', co.map((r) => r.a))
const cols = (await c.query(`select column_name from information_schema.columns where table_name='real_call_authorizations' and column_name in ('job_id','candidate_id','contact_ref')`)).rows
console.log('new auth columns     :', cols.map((r) => r.column_name))
await c.end()
