#!/usr/bin/env node
/** Applies 0029 (service_role grants for the tables 0027/0028 created). Forward-only. */
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2); }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0029_service_role_grants.sql', 'utf8'));
console.log('0029 applied');
for (const t of ['routines', 'holidays', 'adult_availability', 'holiday_arrangements']) {
  const v = (await c.query(`select has_table_privilege('service_role', $1, 'INSERT') v`, [`public.${t}`])).rows[0].v;
  console.log(`${t}: service_role INSERT=${v}`);
}
await c.end();
