import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSchema, parse, validate } from 'graphql';
import { lensQuery } from './lens';
// Delivered router contract, independently observed with GRAPHQL_VALIDATION_FAILED for asOf.
// This fixture keeps only the types/fields selected for a pickup-scoped caller.
const delivered = buildSchema(`
 type CoordinationJob { id: ID!, type: String!, status: String! }
 type CheckIn { recorded: Boolean!, label: String, dueAt: String }
 type Query { coordinationJobs(childId: ID): [CoordinationJob!]!, checkInStatus(childId: ID!): CheckIn }
`);
test('pickup family lens validates against the delivered job contract', () => {
  const query = lensQuery([{ id: 'p_nora', displayName: 'Nora Ellison', scopes: new Set(['pickup.request']) }], '2026-11-04');
  assert.deepEqual(validate(delivered, parse(query)).map(e => e.message), []);
});
