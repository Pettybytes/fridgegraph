#!/usr/bin/env node
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const c = new pg.Client({ connectionString: row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, ''), ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0041_authority_alignment.sql', 'utf8'));
console.log('0041 applied');
await c.end();
