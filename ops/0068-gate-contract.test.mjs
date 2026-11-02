/**
 * 0068 contract — static, CI-runnable, no database.
 *
 * The defect this test exists to prevent: the first draft added `candidate_evaluations_own`, a
 * whole-row SELECT for the candidate, which would have handed a caregiver her own cost, basis,
 * distance and OVER_POLICY reason — contradicting the agreed #87 rule that cost/basis/cap are
 * parent/guardian reads. The migration must expose **status only**, and this test fails if any money
 * column becomes reachable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/0068_candidate_attempt_context.sql', 'utf8');
const body = sql.replace(/--[^\n]*/g, '');

test('0068 adds NO policy on candidate_evaluations (and no policy at all)', () => {
  assert.doesNotMatch(body, /create policy\s+candidate_evaluations_own/i, 'the over-broad row policy must not be re-added');
  const created = [...body.matchAll(/create policy\s+(\w+)\s+on\s+(\w+)/gi)];
  assert.equal(created.length, 0, `expected no policies, found: ${created.map((m) => m[1]).join(', ')}`);
});

test('0068 drops the over-broad draft if it was ever applied', () => {
  assert.match(body, /drop policy if exists candidate_evaluations_own on candidate_evaluations/i);
});

test('0068 exposes status columns only — no cost, basis, distance or provenance', () => {
  for (const column of [
    'estimated_ride_cost_usd',
    'cost_basis',
    'distance_miles',
    'location_provenance',
    'cost_calculated_at',
  ]) {
    assert.ok(!body.includes(column), `0068 must not mention ${column}`);
  }
  assert.match(body, /returns table\s*\(\s*reason_code text\s*,\s*available boolean\s*,\s*accepted_via text\s*,\s*decline_reason text\s*\)/i);
});

test('both helpers are SECURITY DEFINER and gated on the caller being the candidate', () => {
  for (const name of ['candidate_attempt_context', 'candidate_attempt_outcome']) {
    const m = body.match(new RegExp(`create or replace function\\s+${name}\\s*\\(p_attempt text\\)([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$`, 'i'));
    assert.ok(m, `${name} must exist`);
    assert.match(m[1], /security definer/i, `${name} must be SECURITY DEFINER`);
    assert.match(m[2], /a\.candidate_id\s*=\s*current_person\(\)/i, `${name} must be scoped to the candidate`);
    assert.match(m[2], /a\.id\s*=\s*p_attempt/i, `${name} must key on the given attempt`);
  }
});

test('both helpers are granted to authenticated only', () => {
  for (const name of ['candidate_attempt_context', 'candidate_attempt_outcome']) {
    assert.match(body, new RegExp(`revoke all on function ${name}\\(text\\) from public, anon`, 'i'));
    assert.match(body, new RegExp(`grant execute on function ${name}\\(text\\) to authenticated`, 'i'));
  }
});

test('0068 adds no write access and touches no table', () => {
  assert.doesNotMatch(body, /(update|delete from|insert into)\s+(public\.)?(candidate_evaluations|attempts|coordination_jobs)\b/i);
  assert.doesNotMatch(body, /alter table|drop table|truncate/i);
});
