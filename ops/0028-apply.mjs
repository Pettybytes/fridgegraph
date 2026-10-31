#!/usr/bin/env node
/** Applies 0028 (holiday arrangements, effective schedule, conflicts). Forward-only. */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2); }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const sql = readFileSync('supabase/migrations/0028_holiday_arrangements.sql', 'utf8');

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(sql);
console.log('0028 applied');

const q = async (s, p = []) => (await c.query(s, p)).rows;
console.log('routines.applies_on:', (await q(`select column_name from information_schema.columns
  where table_schema='public' and table_name='routines' and column_name='applies_on'`)).length === 1);
console.log('holiday_arrangements policies:', (await q(`select count(*)::int v from pg_policies where tablename='holiday_arrangements'`))[0].v);
console.log('trigger:', (await q(`select tgname from pg_trigger where tgname='holiday_arrangements_approval_guard'`)).length === 1);
for (const fn of ['effective_schedule_for', 'schedule_conflicts', 'can_approve_swap', 'swap_approval_rule']) {
  const v = (await q(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') v
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn]))[0]?.v;
  console.log(`${fn}: authenticated EXECUTE=${v}`);
}
await c.end();
