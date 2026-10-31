#!/usr/bin/env node
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0031_coordination_types_extended.sql', 'utf8'));
console.log('0031 applied');
const def = (await c.query(`select pg_get_constraintdef(oid) d from pg_constraint
  where conrelid='coordination_jobs'::regclass and conname='coordination_jobs_type_check'`)).rows[0].d;
console.log('type check:', def);
await c.end();
