/**
 * Offline tests for the Phase 2 fridge backend (goals CRUD + fridge notes) in village.ts.
 *
 * The authoritative security proof is real-Postgres, not here: ops/fridge-phase2-proof.mjs (31
 * checks: RLS, the immutability triggers, authority, concurrent edits) and
 * ops/fridge-phase2-reset-proof.mjs (5 checks: the real resetDemo() wiring). This file covers what
 * those two don't: the APPLICATION-layer demo-guide guard (refuseDemoGuideWrite), which is TS
 * code, not SQL, and a couple of resolver-wiring smoke tests against a minimal FakeDb so a typo in
 * a column name or argument mapping fails fast without needing Docker.
 *
 * No network call. Run with:
 *   node --import tsx --test src/subgraphs/fridge-phase2.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Ctx } from '../authz';
import villageSubgraph from './village';

const village = villageSubgraph.resolvers;

// ---------------------------------------------------------------------------------------------
// 1. STRUCTURAL — every new mutation refuses the demo guide, first thing, before any read/write.
// ---------------------------------------------------------------------------------------------

const NEW_MUTATIONS = [
  'createGoal', 'updateGoal', 'completeGoal', 'uncompleteGoal', 'deleteGoal',
  'postFridgeNote', 'updateFridgeNote', 'setFridgeNoteAudience', 'removeFridgeNote',
] as const;

test('every new Phase 2 mutation calls refuseDemoGuideWrite as its first statement', () => {
  const source = readFileSync('src/subgraphs/village.ts', 'utf8');
  for (const name of NEW_MUTATIONS) {
    const start = source.indexOf(`${name}: async`);
    assert.ok(start >= 0, `resolver ${name} not found`);
    const bodyStart = source.indexOf('=>', start) + 2;
    const nextStatements = source.slice(bodyStart, bodyStart + 400);
    assert.match(nextStatements, /refuseDemoGuideWrite\(ctx\)/, `${name} must call refuseDemoGuideWrite(ctx)`);
  }
});

test('the new Query resolvers (goals-adjacent) require a caller, same as every other read in this file', () => {
  const source = readFileSync('src/subgraphs/village.ts', 'utf8');
  const start = source.indexOf('fridgeNotes: async');
  assert.ok(start >= 0, 'fridgeNotes resolver not found');
  const body = source.slice(start, source.indexOf('\n    },', start));
  assert.match(body, /requireCaller\(ctx\)/);
});

// ---------------------------------------------------------------------------------------------
// 2. BEHAVIORAL SMOKE — resolver wiring against a minimal FakeDb (not RLS; proven for real
//    separately). Just: does the resolver send the right columns/values and map the result back.
// ---------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeTable(rows: Row[]) {
  const filters: Array<(r: Row) => boolean> = [];
  let lastInsert: Row | null = null;
  let lastUpdate: Row | null = null;
  const builder = {
    select() { return builder; },
    eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
    insert(row: Row) {
      lastInsert = { ...row };
      rows.push(lastInsert);
      return builder;
    },
    update(patch: Row) { lastUpdate = patch; return builder; },
    maybeSingle() {
      return {
        then(onf: (v: { data: Row | null; error: null }) => unknown, onr?: unknown) {
          const matched = rows.find((r) => filters.every((f) => f(r)));
          if (lastUpdate && matched) Object.assign(matched, lastUpdate);
          const data = lastInsert ?? matched ?? null;
          return Promise.resolve({ data, error: null }).then(onf, onr as never);
        },
      };
    },
  };
  return builder;
}

function ctxFor(callerId: string, goalsRows: Row[], notesRows: Row[]): Ctx {
  const db = {
    from(name: string) {
      if (name === 'goals') return fakeTable(goalsRows);
      if (name === 'fridge_notes') return fakeTable(notesRows);
      throw new Error(`unstubbed table: ${name}`);
    },
  };
  return { callerId, today: '2026-11-03', db: db as never };
}

test('createGoal derives proposedById from current_person(), never a client argument, and defaults status to APPROVED', async () => {
  const goalsRows: Row[] = [];
  const ctx = ctxFor('p_mom', goalsRows, []);
  const result = await village.Mutation.createGoal(
    null,
    { childId: 'p_nora', title: 'New goal', ownerId: null, horizon: null, period: 'WEEK', status: null },
    ctx,
  );
  assert.equal(goalsRows[0].proposed_by_id, 'p_mom');
  assert.equal(goalsRows[0].status, 'APPROVED');
  assert.equal(goalsRows[0].period, 'WEEK');
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.period, 'WEEK');
});

test('createGoal asserts sandbox=true explicitly — never relies on the column default, which is false for pre-existing-row safety', async () => {
  const goalsRows: Row[] = [];
  const ctx = ctxFor('p_mom', goalsRows, []);
  await village.Mutation.createGoal(
    null,
    { childId: 'p_nora', title: 'New goal', ownerId: null, horizon: null, period: null, status: null },
    ctx,
  );
  assert.equal(goalsRows[0].sandbox, true);
});

test('postFridgeNote derives authorId from current_person() and maps the GraphQL PaperColor enum to the DB\'s lowercase value', async () => {
  const notesRows: Row[] = [];
  const ctx = ctxFor('p_priya', [], notesRows);
  const result = await village.Mutation.postFridgeNote(
    null,
    { childId: 'p_nora', text: 'Great day!', paperColor: 'PINK', audience: null, attachmentRef: null },
    ctx,
  );
  assert.equal(notesRows[0].author_id, 'p_priya');
  assert.equal(notesRows[0].paper_color, 'pink');
  assert.equal(result.paperColor, 'PINK');
  assert.equal(result.authorId, 'p_priya');
});
