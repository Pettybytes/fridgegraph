#!/usr/bin/env node
/** Applies 0030 (fixture marker). Forward-only. */
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2); }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0030_fixture_marker.sql', 'utf8'));
console.log('0030 applied');
for (const t of ['events', 'coordination_jobs', 'attempts', 'holidays', 'routines', 'adult_availability', 'holiday_arrangements']) {
  const v = (await c.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name=$1 and column_name='fixture'`, [t])).rows.length;
  console.log(`${t}.fixture: ${v === 1}`);
}
await c.end();
