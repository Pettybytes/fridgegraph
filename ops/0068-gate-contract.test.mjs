/**
 * 0068 contract — static, CI-runnable, no database.
 *
 * The behavioural proof is window work (`ops/0066-attempt-access-proof.mjs` against a stack with 0066
 * AND 0068 applied). What can be checked here is that the migration says exactly what the evidence
 * requires: a candidate-scoped definer helper, a candidate-scoped SELECT policy, no write access, and
 * no widening for anyone else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/0068_candidate_attempt_context.sql', 'utf8');
const body = sql.replace(/--[^\n]*/g, '');

test('0068 defines candidate_attempt_context as SECURITY DEFINER, candidate-scoped', () => {
  const fn = body.match(/create or replace function\s+(candidate_attempt_context)\s*\(p_attempt text\)([\s\S]*?)\$\$([\s\S]*?)\$\$/i);
  assert.ok(fn, 'the function must exist');
  const head = fn[2];
  const fnBody = fn[3];
  assert.match(head, /security definer/i);
  assert.match(head, /returns table\s*\(\s*attempt_id text\s*,\s*job_id text\s*,\s*request_version int\s*\)/i);
  assert.match(fnBody, /a\.candidate_id\s*=\s*current_person\(\)/i, 'the predicate must be the candidate herself');
  assert.match(fnBody, /where\s+a\.id\s*=\s*p_attempt/i);
});

test('0068 grants the helper to authenticated only, never public/anon', () => {
  assert.match(body, /revoke all on function candidate_attempt_context\(text\) from public, anon/i);
  assert.match(body, /grant execute on function candidate_attempt_context\(text\) to authenticated/i);
  assert.doesNotMatch(body, /grant execute on function candidate_attempt_context\(text\) to (public|anon)/i);
});

test('0068 adds a candidate-scoped SELECT policy on candidate_evaluations only', () => {
  const policies = [...body.matchAll(/create policy\s+(\w+)\s+on\s+(\w+)\s+for\s+(\w+)\s+to\s+(\w+)\s+using\s*\(([^;]+)\)/gi)];
  assert.equal(policies.length, 1, `expected one policy, found ${policies.length}`);
  const [, name, table, action, role, predicate] = policies[0];
  assert.equal(name, 'candidate_evaluations_own');
  assert.equal(table, 'candidate_evaluations');
  assert.equal(action.toLowerCase(), 'select');
  assert.equal(role, 'authenticated');
  assert.match(predicate, /candidate_id\s*=\s*current_person\(\)/i);
});

test('0068 adds no write access and touches no other table', () => {
  assert.doesNotMatch(body, /create policy[\s\S]*?for\s+(insert|update|delete|all)\b/i);
  assert.doesNotMatch(body, /(update|delete from|insert into)\s+(public\.)?(candidate_evaluations|attempts|coordination_jobs)\b/i);
  assert.doesNotMatch(body, /alter table\s+(?!candidate_evaluations\b)/i);
  assert.doesNotMatch(body, /drop table|truncate/i);
});
