#!/usr/bin/env node
/**
 * ops/0054-apply.mjs — apply 0054 (close outcome + thank-you). Run ONLY in a reserved window,
 * after 0053.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0054_orbit_close_outcome.sql', 'utf8'));
console.log('0054 applied');
const cols = (await c.query(`select column_name from information_schema.columns
  where table_name='orbit_alerts' and column_name in ('close_outcome','last_seen_place_id','last_seen_at') order by column_name`)).rows.map((r) => r.column_name);
console.log('orbit_alerts new columns:', cols.join(','));
const sig = (await c.query(`select pg_get_function_identity_arguments(p.oid) a from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='close_orbit_alert'`)).rows.map((r) => r.a);
console.log('close_orbit_alert signatures:', sig.join(' | '));
await c.end();
