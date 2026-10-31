#!/usr/bin/env node
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0039_care_facts.sql', 'utf8'));
console.log('0039 applied');
console.log('policies:', (await c.query(`select count(*)::int n from pg_policies where tablename='care_facts'`)).rows[0].n);
await c.end();
