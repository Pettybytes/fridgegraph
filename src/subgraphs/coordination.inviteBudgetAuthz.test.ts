/**
 * Proves an ordinary authenticated caller cannot forge a cost or override a settlement outcome
 * through the GraphQL layer, for the invite budget mutations (migration 0085, STAGED — not
 * applied anywhere). Two angles, same technique as coordination.voiceNoteContract.test.ts (REAL
 * GraphQL execution via buildSubgraphSchema against this subgraph's own typeDefs + resolvers):
 *
 *   1. SCHEMA SHAPE closes the forgery vector before any resolver runs: introspect the real
 *      schema and assert reserveInviteBudget/settleInviteBudget have NO cost/price argument of
 *      any kind, and that `status` is the closed InviteGenerationOutcome enum (SUCCEEDED/FAILED/
 *      UNCERTAIN only) — not a free String a caller could set to anything.
 *   2. EXECUTION proves the schema shape is actually enforced (an invalid enum value, or a
 *      missing `proof`, is rejected by GraphQL validation before the resolver or RPC ever runs)
 *      and that the resolvers forward to the RPC ONLY the fixed, documented argument set — never
 *      a caller-influenced cost — and pass the RPC's own allow/deny decision straight through,
 *      never overriding it, INCLUDING when that decision is a refusal of a forged `proof`. The
 *      resolver has no settlement secret of its own: it cannot compute, validate, or distinguish
 *      a real proof from a forged one — only 0085's own hmac check decides trust (settlement is
 *      server-controlled work, not a caller-reported fact; see inviteLedgerBudget.ts).
 *
 * This is the GraphQL half only. The RPC's OWN ownership/replay/forged-signature/forged-proof
 * refusals (the other half of "neither GraphQL nor direct RPC") are proven against a REAL
 * disposable Postgres in ops/invite-budget-proof.mjs (checks 5, 7, 10, and 13).
 *
 * Run with: node --import tsx --test src/subgraphs/coordination.inviteBudgetAuthz.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { graphql, getIntrospectionQuery, type IntrospectionQuery, type IntrospectionObjectType } from 'graphql';
import { buildSubgraphSchema } from '@apollo/subgraph';
import coordinationSubgraph from './coordination';
import type { Ctx } from '../authz';

/** Minimal fake of the chainable subset of supabase-js this test's resolvers actually use —
 *  `.rpc()` only; the invite budget mutations never touch `.from()`. Records every call so a
 *  test can assert exactly which arguments reached "the database". */
class FakeDb {
  public rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  constructor(private rpcResults: Record<string, { data: unknown; error: unknown }>) {}
  rpc(name: string, params: Record<string, unknown>) {
    this.rpcCalls.push({ name, params });
    const result = this.rpcResults[name] ?? { data: null, error: new Error(`no fake result for ${name}`) };
    return Promise.resolve(result);
  }
}

const schema = buildSubgraphSchema([
  { typeDefs: coordinationSubgraph.typeDefs, resolvers: coordinationSubgraph.resolvers as never },
]);

function ctxWith(db: FakeDb): Ctx {
  return { callerId: 'p_mom', today: '2026-11-02', db: db as never };
}

// --- 1. Schema shape: the forgery vector does not exist as a field, before any resolver runs ---

test('reserveInviteBudget has no cost/price argument of any kind — the server alone sets the price', async () => {
  const introspection = (await graphql({ schema, source: getIntrospectionQuery() })) as unknown as { data: IntrospectionQuery };
  const mutation = introspection.data.__schema.types.find(
    (t): t is IntrospectionObjectType => t.name === 'Mutation' && t.kind === 'OBJECT',
  );
  assert.ok(mutation, 'Mutation type must exist');
  const field = mutation.fields.find((f) => f.name === 'reserveInviteBudget');
  assert.ok(field, 'reserveInviteBudget must exist');
  const argNames = field.args.map((a) => a.name);
  assert.deepEqual(
    argNames.sort(),
    ['childId', 'promptHash', 'source'].sort(),
    'reserveInviteBudget must accept exactly childId/source/promptHash — no cost, price, or amount argument of any name',
  );
});

test("settleInviteBudget's status is the closed InviteGenerationOutcome enum, not a free string, and no argument sets a cost", async () => {
  const introspection = (await graphql({ schema, source: getIntrospectionQuery() })) as unknown as { data: IntrospectionQuery };
  const mutation = introspection.data.__schema.types.find(
    (t): t is IntrospectionObjectType => t.name === 'Mutation' && t.kind === 'OBJECT',
  );
  assert.ok(mutation);
  const field = mutation.fields.find((f) => f.name === 'settleInviteBudget');
  assert.ok(field, 'settleInviteBudget must exist');
  const argNames = field.args.map((a) => a.name);
  assert.deepEqual(
    argNames.sort(),
    ['cached', 'generationId', 'model', 'outputSha256', 'proof', 'status'].sort(),
    'settleInviteBudget must accept exactly these six arguments — no cost/price/amount argument',
  );
  const proofArg = field.args.find((a) => a.name === 'proof');
  assert.ok(proofArg, 'proof argument must exist — settlement is trusted server work, not a caller-reported fact');
  assert.equal(proofArg.type.kind, 'NON_NULL', 'proof must be required, never optional');
  const statusArg = field.args.find((a) => a.name === 'status');
  assert.ok(statusArg, 'status argument must exist');
  // NON_NULL wrapping an ENUM named InviteGenerationOutcome — never SCALAR String.
  assert.equal(statusArg.type.kind, 'NON_NULL');
  const inner = (statusArg.type as { ofType?: { kind: string; name?: string } }).ofType;
  assert.equal(inner?.kind, 'ENUM', 'status must be an enum type, not a free string a caller could set to anything');
  assert.equal(inner?.name, 'InviteGenerationOutcome');

  const outcomeEnum = introspection.data.__schema.types.find((t) => t.name === 'InviteGenerationOutcome' && t.kind === 'ENUM');
  assert.ok(outcomeEnum && 'enumValues' in outcomeEnum, 'InviteGenerationOutcome enum must exist');
  const values = [...((outcomeEnum as unknown as { enumValues: Array<{ name: string }> }).enumValues)].map((v) => v.name).sort();
  assert.deepEqual(values, ['FAILED', 'SUCCEEDED', 'UNCERTAIN'], 'the outcome set must stay exactly these three values');
});

// --- 2. Execution: the shape is actually enforced, and resolvers forward only the fixed set ---

test('an invalid status value is rejected by GraphQL validation — the RPC is never called', async () => {
  const db = new FakeDb({});
  const result = await graphql({
    schema,
    source: `mutation { settleInviteBudget(generationId: "g1", status: FORGED_FREE, cached: false, proof: "whatever") }`,
    contextValue: ctxWith(db),
  });
  assert.ok(result.errors && result.errors.length > 0, 'an out-of-enum status must be a GraphQL error');
  assert.equal(db.rpcCalls.length, 0, 'invite_budget_settle must never be called for a request GraphQL itself rejects');
});

test('omitting proof entirely is a GraphQL validation error — the RPC is never called', async () => {
  const db = new FakeDb({});
  const result = await graphql({
    schema,
    source: `mutation { settleInviteBudget(generationId: "g1", status: FAILED, cached: false) }`,
    contextValue: ctxWith(db),
  });
  assert.ok(result.errors && result.errors.length > 0, 'proof is required — a settle call without it must not even reach the resolver');
  assert.equal(db.rpcCalls.length, 0, 'invite_budget_settle must never be called for a request missing proof');
});

test('reserveInviteBudget forwards exactly {p_child, p_source, p_prompt_hash} to the RPC — no cost field, nothing extra', async () => {
  const db = new FakeDb({
    invite_budget_reserve: { data: [{ allowed: true, generation_id: 'gen_1', remaining_usd: 0.99 }], error: null },
  });
  const result = await graphql({
    schema,
    source: `mutation { reserveInviteBudget(childId: "p_nora", source: "MUSE_IMAGE", promptHash: "h1") { allowed generationId remainingUsd } }`,
    contextValue: ctxWith(db),
  });
  assert.deepEqual(result.errors, undefined, JSON.stringify(result.errors));
  assert.equal(db.rpcCalls.length, 1);
  assert.equal(db.rpcCalls[0].name, 'invite_budget_reserve');
  assert.deepEqual(
    Object.keys(db.rpcCalls[0].params).sort(),
    ['p_child', 'p_prompt_hash', 'p_source'].sort(),
    'no p_cost_usd or any other price-shaped field may reach the RPC call',
  );
});

test('settleInviteBudget forwards exactly {p_generation, p_status, p_model, p_output_sha256, p_cached, p_proof} — no cost field, proof forwarded verbatim', async () => {
  const db = new FakeDb({ invite_budget_settle: { data: true, error: null } });
  const result = await graphql({
    schema,
    source: `mutation { settleInviteBudget(generationId: "gen_1", status: SUCCEEDED, model: "muse-image-1.0", outputSha256: "deadbeef", cached: true, proof: "realproof123") }`,
    contextValue: ctxWith(db),
  });
  assert.deepEqual(result.errors, undefined, JSON.stringify(result.errors));
  assert.equal(db.rpcCalls.length, 1);
  assert.equal(db.rpcCalls[0].name, 'invite_budget_settle');
  assert.deepEqual(
    Object.keys(db.rpcCalls[0].params).sort(),
    ['p_cached', 'p_generation', 'p_model', 'p_output_sha256', 'p_proof', 'p_status'].sort(),
    'no p_cost_usd or any other price-shaped field may reach the RPC call',
  );
  assert.equal(db.rpcCalls[0].params.p_status, 'SUCCEEDED', 'the enum value is forwarded verbatim, never translated into a price');
  assert.equal(db.rpcCalls[0].params.p_proof, 'realproof123', 'proof is forwarded verbatim — this resolver never computes, validates, or substitutes it; only 0085\'s own hmac check decides trust');
});

test("the RPC's own refusal (an unowned/already-settled reservation, OR a garbage/forged proof) passes straight through as false — the GraphQL layer adds no override", async () => {
  const db = new FakeDb({ invite_budget_settle: { data: false, error: null } });
  const result = await graphql({
    schema,
    source: `mutation { settleInviteBudget(generationId: "someone_elses_gen", status: SUCCEEDED, cached: false, proof: "garbage-not-a-real-hmac") }`,
    contextValue: ctxWith(db),
  });
  assert.deepEqual(result.errors, undefined, JSON.stringify(result.errors));
  const data = result.data as { settleInviteBudget: boolean };
  assert.equal(data.settleInviteBudget, false, 'a caller who does not own the reservation, or whose proof the RPC rejects, must see false, never a silently-upgraded true');
});

test('a plausible-looking but forged proof does not let a caller falsely release its OWN reservation — the resolver has no secret of its own to validate or compute a correct one, only the RPC decides', async () => {
  // The resolver cannot distinguish a real Rosina-computed proof from a forged one by
  // inspection — it has no settlement secret. Whatever the RPC decides (simulated here as a
  // refusal, matching 0085's real hmac check on a mismatched proof) is exactly what the caller
  // sees; there is no app-layer fallback that could accept a forged proof the RPC refused.
  const db = new FakeDb({ invite_budget_settle: { data: false, error: null } });
  const result = await graphql({
    schema,
    source: `mutation { settleInviteBudget(generationId: "my_own_gen", status: FAILED, cached: false, proof: "i-made-this-up") }`,
    contextValue: ctxWith(db),
  });
  assert.deepEqual(result.errors, undefined, JSON.stringify(result.errors));
  const data = result.data as { settleInviteBudget: boolean };
  assert.equal(data.settleInviteBudget, false, 'a forged proof must not falsely release a reservation, even the caller\'s own');
  assert.equal(db.rpcCalls[0].params.p_proof, 'i-made-this-up', 'the forged value is forwarded as-is — the RPC, not the resolver, is what refuses it');
});

test('an unauthenticated caller is refused before the RPC is ever reached, for both mutations', async () => {
  const dbReserve = new FakeDb({});
  const unauthed: Ctx = { today: '2026-11-02' } as Ctx; // no callerId
  const r1 = await graphql({
    schema,
    source: `mutation { reserveInviteBudget(childId: "p_nora", source: "MUSE_IMAGE", promptHash: "h1") { allowed } }`,
    contextValue: { ...unauthed, db: dbReserve as never },
  });
  assert.ok(r1.errors && r1.errors.length > 0, 'an unauthenticated reserve attempt must be refused');
  assert.equal(dbReserve.rpcCalls.length, 0, 'invite_budget_reserve must never be called for an unauthenticated caller');

  const dbSettle = new FakeDb({});
  const r2 = await graphql({
    schema,
    source: `mutation { settleInviteBudget(generationId: "g1", status: SUCCEEDED, cached: false, proof: "whatever") }`,
    contextValue: { ...unauthed, db: dbSettle as never },
  });
  assert.ok(r2.errors && r2.errors.length > 0, 'an unauthenticated settle attempt must be refused');
  assert.equal(dbSettle.rpcCalls.length, 0, 'invite_budget_settle must never be called for an unauthenticated caller');
});
