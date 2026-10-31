#!/usr/bin/env node
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0034_orbit_controlled_vocabulary.sql', 'utf8'));
console.log('0034 applied');
console.log('vocabulary rows:', (await c.query(`select count(*)::int v from orbit_vocabulary`)).rows[0].v);
const sig = (await c.query(`select pg_get_function_identity_arguments(p.oid) a from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='draft_orbit_share'`)).rows.map((r) => r.a);
console.log('draft_orbit_share signatures:', sig.join(' | '));
await c.end();
