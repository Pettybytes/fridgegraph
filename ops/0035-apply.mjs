#!/usr/bin/env node
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0035_orbit_checkin_signal.sql', 'utf8'));
console.log('0035 applied');
console.log('tables:', (await c.query(`select count(*)::int v from information_schema.tables where table_schema='public' and table_name in ('expected_checkins','check_ins')`)).rows[0].v);
await c.end();
