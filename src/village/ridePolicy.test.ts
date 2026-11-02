/**
 * Paid-ride policy invariants, checked against the SQL itself — offline.
 *
 * WHY THIS EXISTS
 * The within-cap outcome is easy to "fix" by accident: change one comparison, or store an estimate on
 * the within-cap path, and the product starts surfacing a paid ride it is not allowed to arrange. This
 * file pins the policy that 0019/0020/0060 already decide, and fails if a later edit quietly relaxes
 * it — including an edit that changes 0060's cap comparison or touches the reply path.
 *
 * THE CONDITION, NAMED
 * `_rank_and_advance` reaches the paid branch only when NO candidate can drive. There it computes an
 * estimate and compares it with the household's `ride_cost_cap_usd`:
 *
 *     if v_cap is not null and v_alt_cost is not null and v_alt_cost > v_cap   → OVER_POLICY
 *
 * Strictly greater, so an estimate exactly AT the cap is inside the limit. Anything else — estimate at
 * or under the cap, or no readable cap — falls through to:
 *
 *     status = 'failed', failure_reason = 'no_driver_available'
 *
 * That is 0019 §3, not a bug: "A ride estimate within the limit is out of scope this release: the job
 * fails with failure_reason 'no_driver_available' and Rosina reports that no driver is available."
 * Nothing is booked, no estimate is surfaced, and no cost row is written on that path.
 *
 * Run offline: node --import tsx --test src/village/ridePolicy.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p: string) => readFileSync(p, 'utf8');
const rank0065 = read('supabase/migrations/0065_price_leg_in_pickup_direction.sql');
const rank0060 = read('supabase/migrations/0060_rank_uses_road_distance.sql');
const reply0020 = read('supabase/migrations/0020_transport_reply_cost.sql');

const fnBody = (sql: string, name: string) => {
  const start = sql.indexOf(`create or replace function ${name}`);
  assert.ok(start > -1, `${name} not found`);
  const end = sql.indexOf('$$;', start);
  return sql.slice(start, end);
};

test('the over-cap branch is strictly greater than the cap — at the cap is inside it', () => {
  const body = fnBody(rank0065, '_rank_and_advance');
  assert.match(body, /v_alt_cost > v_cap/, 'the comparison must stay strictly greater');
  assert.equal(/v_alt_cost >= v_cap/.test(body), false, 'a >= change would flag an in-limit estimate');
});

test('the fallthrough names the sanctioned outcome, and stores no estimate there', () => {
  const body = fnBody(rank0065, '_rank_and_advance');
  assert.match(body, /failure_reason = 'no_driver_available'/);

  // Find the last statement of the function: the fallthrough that follows the over-cap branch.
  const fallthrough = body.slice(body.lastIndexOf("failure_reason = 'no_driver_available'") - 200);
  assert.equal(/estimated_ride_cost_usd\s*=/.test(fallthrough), false,
    'the within-cap path must not write a cost');
  assert.equal(/cost_basis\s*=/.test(fallthrough), false,
    'the within-cap path must not write a basis');
});

test('the household cap is read, never written, by the pricing function', () => {
  const body = fnBody(rank0065, '_rank_and_advance');
  assert.match(body, /from household_policies hp/);
  assert.equal(/update\s+household_policies/i.test(body), false);
  assert.equal(/insert\s+into\s+household_policies/i.test(body), false);
  assert.equal(/delete\s+from\s+household_policies/i.test(body), false);
});

test('0065 changes the direction line and nothing else against 0060', () => {
  const body = (sql: string) => sql.slice(
    sql.indexOf('create or replace function _rank_and_advance'),
    sql.indexOf('revoke all on function _rank_and_advance'),
  );
  const a = body(rank0060).split('\n');
  const b = body(rank0065).split('\n');
  assert.equal(a.length, b.length, 'the bodies must have the same line count');

  const changed = a.map((line, i) => (line === b[i] ? null : i)).filter((i) => i !== null);
  assert.equal(changed.length, 1, `exactly one line may differ, found ${changed.length}`);
  assert.match(b[changed[0] as number], /ride_miles_for\(l\.lat, l\.lng, v_school\.lat, v_school\.lng\)/);
});

test('the pricing replacement does not touch the reply path or approval entry points', () => {
  for (const name of ['accept_pickup', 'accept_pickup_webhook', 'approve_pickup', 'request_pickup']) {
    assert.equal(rank0065.includes(name), false, `0065 must not redefine ${name}`);
  }
});

test('0020 still writes NO cost on the reply path', () => {
  // Comments carry the rolled-back OLD body, which DID assign v_cost. Strip them so the assertion is
  // about executable SQL, not about the historical note that explains why it is gone.
  const code = reply0020
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  assert.match(code, /estimated_ride_cost_usd = v_cost/);
  assert.equal(/v_cost\s*:=/.test(code), false,
    'v_cost must never be assigned — an assignment would make the reply path price a ride');
});
