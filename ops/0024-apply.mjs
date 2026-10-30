#!/usr/bin/env node
/** Applies 0024_authority_model.sql (forward-only). Persists the migration only. */
import pg from 'pg'
import { readFileSync } from 'node:fs'
const env = readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2) }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '')
const sql = readFileSync('supabase/migrations/0024_authority_model.sql', 'utf8')
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
await c.query(sql)
console.log('0024 applied')
const con = (await c.query(`select pg_get_constraintdef(oid) d from pg_constraint
  where conrelid='household_members'::regclass and conname='household_members_role_check'`)).rows[0]
console.log('role check:', con?.d)
for (const fn of ['is_parent_of', 'parent_ids_of']) {
  const def = (await c.query(`select pg_get_functiondef($1::regproc) d`, [fn])).rows[0].d
  console.log(`${fn}:`, def.match(/role in \([^)]*\)/)?.[0] ?? 'NO WIDENED LIST')
}
await c.end()
