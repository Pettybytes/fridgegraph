/**
 * 0066 contract — static, CI-runnable, no database.
 *
 * The behavioural proof (`ops/0066-attempt-access-proof.mjs`) needs 0066 applied to a served stack,
 * which is a window step. What CAN be checked here is that the migration says exactly what the
 * evidence requires: one additive candidate-scoped SELECT policy, no broadening of the parent read,
 * and no write policy that would let a caller update attempts directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/0066_attempt_candidate_read.sql', 'utf8');
const body = sql.replace(/--[^\n]*/g, '');

test('0066 creates exactly one policy, candidate-scoped, SELECT to authenticated', () => {
  const policies = [...body.matchAll(/create policy\s+(\w+)\s+on\s+(\w+)\s+for\s+(\w+)\s+to\s+(\w+)\s+using\s*\(([^;]+)\)/gi)];
  assert.equal(policies.length, 1, `expected one policy, found ${policies.length}`);
  const [, name, table, action, role, predicate] = policies[0];
  assert.equal(name, 'attempts_read_own');
  assert.equal(table, 'attempts');
  assert.equal(action.toLowerCase(), 'select');
  assert.equal(role, 'authenticated');
  assert.match(predicate, /candidate_id\s*=\s*current_person\(\)/i);
});

test('0066 does not touch the existing parent read', () => {
  assert.doesNotMatch(body, /drop policy[^;]*attempts_read\b/i);
  assert.doesNotMatch(body, /alter policy[^;]*attempts_read\b/i);
});

test('0066 adds no write access to attempts', () => {
  assert.doesNotMatch(body, /create policy[\s\S]*?for\s+(insert|update|delete|all)\b/i);
  assert.doesNotMatch(body, /(update|delete from|insert into)\s+(public\.)?attempts\b/i);
});

test('0066 is forward-only and touches no other table', () => {
  assert.doesNotMatch(body, /alter table\s+(?!attempts\b)/i);
  assert.doesNotMatch(body, /drop table|truncate/i);
});
