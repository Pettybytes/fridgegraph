#!/usr/bin/env node
/**
 * Dry run for 0019 + 0020 together.
 *
 * Applies both inside one transaction, checks the semantics each is responsible for, then rolls
 * back. Hashes the function definitions before, after-apply and after-rollback: the final hash must
 * equal the original. Applies nothing, prints no credentials.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2) }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '')

const strip = (f) => readFileSync(f, 'utf8')
  .split('\n').filter((l) => !/^\s*(begin|commit);\s*$/.test(l)).join('\n')

const m19 = strip('supabase/migrations/0019_transport_policy.sql')
const m20 = strip('supabase/migrations/0020_transport_reply_cost.sql')

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const defs = async () => {
  const q = await c.query(`
    select p.proname, pg_get_functiondef(p.oid) d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public'
       and p.proname in ('_rank_and_advance','approve_pickup','accept_pickup_webhook')
     order by p.proname, p.oid`)
  return q.rows
}
const hash = async () => (await c.query(`
  select md5(string_agg(d, '|' order by d)) h from (
    select pg_get_functiondef(p.oid) d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public'
       and p.proname in ('_rank_and_advance','approve_pickup','accept_pickup_webhook')) s`)).rows[0].h

const before = await hash()
console.log('hash before      :', before)

await c.query('begin')
try {
  await c.query(m19)
  await c.query(m20)
  const after = await hash()
  console.log('hash after apply :', after, after !== before ? '(changed)' : '(UNCHANGED — problem)')

  const rows = await defs()
  const pick = (name) => {
    // the 6-arg webhook variant is the last one; prefer the one mentioning p_event_id
    const hits = rows.filter((r) => r.proname === name)
    return hits.find((r) => r.d.includes('p_event_id')) || hits[hits.length - 1]
  }
  const rank = pick('_rank_and_advance').d
  const approve = pick('approve_pickup').d
  const hook = pick('accept_pickup_webhook').d

  const checks = [
    ['0019 rank: no cost gate', !/cost <= v_cap/.test(rank)],
    ['0019 rank: null cost on driver', /estimated_ride_cost_usd = null/.test(rank)],
    ['0019 rank: in-limit deferred', /no_driver_available/.test(rank)],
    ['0019 rank: no-car restriction', /not exists \(select 1 from vehicles/.test(rank)],
    ['0019 approve: ride guard', /OVER_LIMIT_NOT_RIDE_OPTION/.test(approve)],
    ['0019 approve: accept bit kept', /OVER_LIMIT_NOT_ACCEPTED/.test(approve)],
    ['0020 hook: no OVER_POLICY at reply', !/OVER_POLICY/.test(hook.replace(/--.*$/gm, ''))],
    ['0020 hook: no estimate call anywhere', !/estimate_ride_cost_usd/.test(hook)],
    ['0020 hook: cost column written as null', /estimated_ride_cost_usd = v_cost/.test(hook)],
    ['0020 hook: dedupe intact', /EVENT_ID_CONFLICT/.test(hook) && /'duplicate'/.test(hook)],
  ]
  for (const [name, ok] of checks) console.log((ok ? 'PASS  ' : 'FAIL  ') + name)
  if (checks.some(([, ok]) => !ok)) throw new Error('semantic check failed')
} catch (e) {
  console.log('APPLY FAILED:', e.message)
  await c.query('rollback'); await c.end(); process.exit(1)
}

await c.query('rollback')
const after = await hash()
console.log('hash after rollback:', after, after === before ? '(restored)' : '(NOT RESTORED — problem)')
await c.end()
if (after !== before) { console.log('DRY RUN FAILED'); process.exit(1) }
console.log('DRY RUN OK — nothing persisted')
