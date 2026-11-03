/**
 * Pins the 2026-11-03 SDL-drift incident.
 *
 * `compose:local` reads the committed `schema/*.graphql` while the services serve the typeDefs in
 * `src/subgraphs/*.ts`. When the two drifted apart, composition still exited 0 and merely produced
 * a supergraph without `checkInStatus`, `orbitStatus`, `myChildren`, `jobTimeline` or `careFacts`, so
 * every invite failed GraphQL validation (403 UNAUTHORIZED) and the MCP load reported
 * `ERROR field orbitStatus not found`. These tests are the gate that keeps that from recurring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { checkAll, fieldIndex, renderSubgraph, stripDescriptions, SUBGRAPHS } from './gen-subgraph-sdl.mjs';

test('the committed SDL matches src/subgraphs/*.ts', async () => {
  const { ok, drift } = await checkAll();
  assert.ok(ok, `stale SDL: ${JSON.stringify(drift)}`);
});

test('every committed schema file is a registered subgraph, and vice versa', () => {
  const files = readdirSync(new URL('../schema/', import.meta.url))
    .filter((f) => f.endsWith('.graphql'))
    .map((f) => f.replace(/\.graphql$/, ''))
    .sort();
  assert.deepEqual(files, [...SUBGRAPHS].sort());
});

test('rendering is deterministic', async () => {
  const first = await renderSubgraph('coordination');
  const second = await renderSubgraph('coordination');
  assert.equal(first, second);
});

test('the check goes red, and names the field, when the SDL is missing one', async () => {
  const rendered = await renderSubgraph('coordination');
  assert.match(rendered, /checkInStatus\(childId: ID!\): CheckInStatus!/);

  // Same document, one served field deleted — the exact shape of the 2026-11-03 drift.
  const mutilated = rendered.replace(/\n\s*checkInStatus\(childId: ID!\): CheckInStatus!/, '\n');
  const { ok, drift } = await checkAll({ names: ['coordination'], read: () => mutilated });

  assert.equal(ok, false);
  assert.equal(drift[0].name, 'coordination');
  assert.deepEqual(drift[0].missing, ['Query.checkInStatus']);
});

test('a committed file that does not exist is reported as missing, not silently skipped', async () => {
  const { ok, drift } = await checkAll({
    names: ['coordination'],
    read: () => {
      throw new Error('ENOENT');
    },
  });
  assert.equal(ok, false);
  assert.equal(drift[0].kind, 'missing');
});

test('stripping descriptions changes no type or field', async () => {
  const withDescriptions = `
    """
    A person.
    """
    type Person {
      "their id"
      id: ID!
    }
    type Query {
      person: Person
    }
  `;
  const stripped = stripDescriptions(withDescriptions);
  assert.ok(!stripped.includes('A person.'));
  assert.deepEqual([...fieldIndex(stripped)].sort(), [...fieldIndex(withDescriptions)].sort());
});
