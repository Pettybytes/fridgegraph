#!/usr/bin/env node
/**
 * ops/0055-revert.mjs — restore the pre-0055 read grants, for a window that proves the boundary
 * without leaving `main` unable to serve.
 *
 * WHY THIS EXISTS: 0055 revokes the sensitive columns and hands them to an accessor. `main`'s
 * resolver still selects those columns directly, so the migration and the resolver must ship in the
 * SAME deploy. A proof window applies 0055, serves the branch, proves the boundary — and then has to
 * put the grants back, or restoring `main` would leave Orbit unreadable (42501) rather than redacted.
 *
 * The migration is NOT deleted and nothing here weakens the PR: the boundary is re-established the
 * moment 0055 is applied again, in the deploy that carries the resolver.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query('begin');
// table-level SELECT back
await c.query('grant select on table public.orbit_alerts to authenticated');
// the explicit column grants that existed before 0055
await c.query(`grant select (
  id, child_id, created_by, created_at, status, draft_version,
  activated_by, activated_at, closed_by, closed_at, job_id, message_hash,
  sandbox, fixture, wearing, wear_color, wear_garment, hair, hair_desc,
  carrying, carry_color, carry_item, distinctive, minimal_message, photo_id,
  last_seen_place_id, last_seen_at
) on table public.orbit_alerts to authenticated`);
// PUBLIC execute, as it was (photo_access and preview_orbit_share)
await c.query('grant execute on function public.orbit_photo_access(text) to public');
await c.query('grant execute on function public.preview_orbit_share(text) to public');
// the accessors stay; they are additive and harmless without the column boundary
await c.query('commit'); // c.commit is a method: awaiting the reference commits nothing

const t = await c.query(`select count(*)::int n from information_schema.role_table_grants
  where table_name='orbit_alerts' and grantee='authenticated' and privilege_type='SELECT'`);
console.log('reverted: authenticated table-level SELECT restored =', t.rows[0].n === 1);
console.log('NOTE: the accessors (orbit_share_for, orbit_place_for) remain in place.');
await c.end();
