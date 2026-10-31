#!/usr/bin/env node
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0038_orbit_vocabulary_read.sql', 'utf8'));
console.log('0038 applied');
console.log('policies:', JSON.stringify((await c.query(`select policyname from pg_policies where tablename='orbit_vocabulary'`)).rows));
await c.end();
