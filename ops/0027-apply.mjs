#!/usr/bin/env node
/** Applies 0027 (events status, holidays, routines, adult availability). Persists the migration only. */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2); }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const sql = readFileSync('supabase/migrations/0027_events_holidays_availability.sql', 'utf8');

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(sql);
console.log('0027 applied');

const cols = (await c.query(`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'events' and column_name = 'status'`)).rows;
console.log('events.status present:', cols.length === 1);

for (const t of ['routines', 'holidays', 'adult_availability']) {
  const rls = (await c.query(`select relrowsecurity from pg_class where relname = $1`, [t])).rows[0];
  const n = (await c.query(`select count(*)::int v from pg_policies where tablename = $1`, [t])).rows[0].v;
  console.log(`${t}: rls=${rls?.relrowsecurity} policies=${n}`);
}
const view = (await c.query(`select column_name from information_schema.columns
  where table_schema='public' and table_name='adult_availability_free_busy' order by ordinal_position`)).rows.map((r) => r.column_name);
console.log('view columns:', view.join(','));
for (const fn of ['holiday_covers', 'day_kind', 'day_routines', 'shares_village_with']) {
  const ok = (await c.query(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname=$1`, [fn])).rows[0]?.v;
  console.log(`${fn}: authenticated EXECUTE=${ok}`);
}
await c.end();
