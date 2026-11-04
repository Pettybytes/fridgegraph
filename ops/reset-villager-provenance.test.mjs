/**
 * 0081 contract — the demo reset must not leave an Add-a-Villager grant without its audit row.
 *
 * Static guard for the decisions; the behavioural proof is the disposable-Postgres run recorded in
 * the PR (confirm → reset restores baseline → second reset is safe → protected rows survive).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/0081_reset_demo_villager_provenance.sql', 'utf8');
const reset = readFileSync('src/demo/reset.ts', 'utf8');

test('the cleanup is driven by proposal provenance, not by time or id shape', () => {
  assert.match(migration, /create or replace function public\.reset_demo_villager_provenance/);
  assert.match(migration, /from villager_proposals/);
  assert.match(migration, /a\.subject_type = 'Grant'/);
  assert.match(migration, /a\.subject_id = p\.confirmed_grant_id/);
  assert.ok(!/created_at\s*[<>]/.test(migration), 'no time-based deletion');
});

test('it covers grants, approvals, proposals and relationships together', () => {
  for (const table of ['approvals', 'grants', 'relationships', 'villager_proposals']) {
    assert.ok(migration.includes(`delete from ${table}`) || migration.includes(`update relationships`),
      `cleanup must touch ${table}`);
  }
});

test('a seeded relationship is restored via an explicit map, not a blanket downgrade', () => {
  assert.match(migration, /r\.id = 'r_dana_friend_parent'/);
  assert.match(migration, /set status = 'DISCOVERED'/);
  assert.match(migration, /src\/fixtures\.ts/);
});

test('it is atomic, locked down, and called inside the reset transaction', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(migration, /revoke all on function public\.reset_demo_villager_provenance\(\) from public, anon, authenticated/);
  assert.ok(!/grant execute on function public\.reset_demo_villager_provenance/.test(migration),
    'a reset primitive must not be executable by an API caller');
  assert.match(reset, /select public\.restore_demo_snapshot\(/);
  const fast = readFileSync(new URL('../supabase/migrations/0096_fast_demo_restore.sql', import.meta.url), 'utf8');
  assert.match(fast, /counts := public\.reset_demo_villager_provenance\(\)/);
  assert.match(fast, /pg_try_advisory_xact_lock\(918273645\)/);
  assert.ok(fast.indexOf('reset_demo_villager_provenance()') < fast.indexOf('insert into public.demo_reset_runs'));
  // wired before the orbit audit so its counts ride in the reset report
  assert.ok(fast.indexOf('reset_demo_villager_provenance()') < fast.indexOf('reset_demo_orbit(p_actor'));
});

test('the cast checksum inputs explain the drift: grants are digested', () => {
  const health = readFileSync('ops/stack-health.mjs', 'utf8');
  assert.match(health, /digestRows\('grants', 'id'\)/);
  assert.match(health, /digestRows\('care_facts', 'child_id, key'\)/);
  assert.match(health, /digestRows\('routines', 'id'\)/);
});
