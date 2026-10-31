#!/usr/bin/env node
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const c = new pg.Client({ connectionString: row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, ''), ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0040_approval_policies.sql', 'utf8'));
console.log('0040 applied');
console.log('policies:', JSON.stringify((await c.query(`select household_id, value from household_policies where rule='schedule_swap_approval' order by household_id`)).rows));
await c.end();
