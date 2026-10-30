#!/usr/bin/env node
/** Apply 0019 then 0020 once, verify the definitions changed. Prints no credentials. */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2) }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '')

const files = ['supabase/migrations/0019_transport_policy.sql', 'supabase/migrations/0020_transport_reply_cost.sql']
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const hash = async () => (await c.query(`
  select md5(string_agg(d, '|' order by d)) h from (
    select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.proname in ('_rank_and_advance','approve_pickup','accept_pickup_webhook')) s`)).rows[0].h

const before = await hash()
for (const f of files) {
  await c.query(readFileSync(f, 'utf8'))
  console.log('applied', f.split('/').pop())
}
const after = await hash()

const hook = (await c.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='accept_pickup_webhook' and pg_get_functiondef(p.oid) like '%p_event_id%'`)).rows[0].d

console.log('hash before:', before)
console.log('hash after :', after, after !== before ? '(changed)' : '(UNCHANGED — problem)')
console.log('reply never OVER_POLICY :', !/OVER_POLICY/.test(hook.replace(/--.*$/gm, '')))
console.log('no estimate on reply path :', !/estimate_ride_cost_usd/.test(hook))
await c.end()
if (after === before) process.exit(1)
