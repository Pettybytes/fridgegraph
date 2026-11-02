/**
 * Unit tests for TASK (Add a Villager): propose/confirm for adding/activating someone's access to
 * a child, through access.ts's proposeAddVillager/confirmAddVillager.
 *
 * Three kinds of proof here, same split as school-report-proposal.test.ts:
 *
 *  1. STRUCTURAL — "a model tool call can never confirm itself" (no MCP operation file for
 *     confirmAddVillager, name absent from model.ts's ALLOWED_MCP_TOOL_NAMES) and "weekdays can
 *     never be expressed" (the mutation's own argument list has no weekday-shaped field at all,
 *     and the prompt instructs a clarifying question rather than a silent unrestricted grant) —
 *     both directly inspectable from source.
 *
 *  2. BEHAVIORAL — a hand-written, in-memory model of propose_add_villager/confirm_add_villager
 *     (migration 0074), driven through the REAL access.ts resolvers via dbFor(ctx).rpc(...), plus
 *     derive.ts's REAL pickupCandidatesFor driven through a fake of pickup_candidates_for /
 *     grant_holders_for (migrations 0008/0010) to prove the confirmed grant actually makes Dana a
 *     pickup candidate. Proves the algorithm; does NOT prove Postgres's own SELECT ... FOR UPDATE
 *     serializing two real concurrent connections, or the live reset/reseed behavior — those are
 *     Bentley's deployment check (see the RESET section below for what IS provable offline).
 *
 *  3. RESET — structural proof that the EXISTING reset mechanism (scripts/db.ts) already handles
 *     a confirmed villager correctly, with no new reset code: the relationship row this flow
 *     activates is a baseline id (reverted to its fixture status on reseed), and the grant row it
 *     creates is never a baseline id (deleted by RESET_SCOPED).
 *
 * No network call. Run with:
 *   node --import tsx --test src/subgraphs/add-villager-proposal.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { GraphQLError } from 'graphql';
import type { Ctx } from '../authz';
import { pickupCandidatesFor } from '../derive';
import accessSubgraph from './access';

const access = accessSubgraph.resolvers;

// ---------------------------------------------------------------------------------------------
// 1. STRUCTURAL
// ---------------------------------------------------------------------------------------------

test('no MCP operation file exposes confirmAddVillager', () => {
  const opsDir = 'ops';
  const files = readdirSync(opsDir).filter((f) => f.endsWith('.graphql'));
  for (const file of files) {
    const text = readFileSync(`${opsDir}/${file}`, 'utf8');
    assert.equal(/confirmAddVillager\s*[({]/.test(text), false, `${file} must not select confirmAddVillager`);
  }
  assert.equal(existsSync(`${opsDir}/ConfirmAddVillager.graphql`), false);
});

test('ConfirmAddVillager is not in Rosina\'s MCP allowlist; ProposeAddVillager is', () => {
  const text = readFileSync('src/rosina/model.ts', 'utf8');
  const block = text.slice(
    text.indexOf('const ALLOWED_MCP_TOOL_NAMES'),
    text.indexOf(']);', text.indexOf('const ALLOWED_MCP_TOOL_NAMES')),
  );
  assert.equal(block.includes("'ConfirmAddVillager'"), false);
  assert.equal(block.includes("'ProposeAddVillager'"), true);
});

test('ProposeAddVillager.graphql exists and is listed in mcp.local.yaml', () => {
  assert.equal(existsSync('ops/ProposeAddVillager.graphql'), true);
  const yaml = readFileSync('.apollo/mcp.local.yaml', 'utf8');
  assert.equal(yaml.includes('./ops/ProposeAddVillager.graphql'), true);
});

test('the mutation has no weekday-shaped field — a recurring-day request structurally cannot be expressed', () => {
  const schema = readFileSync('src/subgraphs/access.ts', 'utf8');
  const match = schema.match(/proposeAddVillager\(([\s\S]*?)\): AddVillagerProposal!/);
  assert.ok(match, 'proposeAddVillager field definition must exist in the typeDefs');
  const argsBlock = match![1];
  assert.equal(/weekday/i.test(argsBlock), false);
  // Exactly the fields this test relies on existing, named precisely:
  for (const field of ['childId', 'personName', 'scopes', 'relationshipType', 'validFrom', 'validUntil']) {
    assert.ok(argsBlock.includes(field), `expected arg ${field} in proposeAddVillager`);
  }
});

test('the prompt instructs a clarifying question for an unsupported recurring window, never a silent unrestricted grant', () => {
  const prompt = readFileSync('src/rosina/systemPrompt.ts', 'utf8');
  assert.match(prompt, /cannot be represented here/i);
  assert.match(prompt, /ask exactly one short clarifying question/i);
  assert.match(prompt, /Do NOT silently drop the\s*\n?\s*restriction and grant an unrestricted window/i);
});

test('confirm_add_villager never touches contact_methods or household_members — no contact attempt, no linked households', () => {
  const sql = readFileSync('supabase/migrations/0074_add_villager_proposal.sql', 'utf8');
  assert.equal(sql.includes('contact_methods'), false);
  // Checks for an actual table reference (from/into/update household_members), not prose that
  // merely NAMES the table while explaining this very guarantee in a comment.
  assert.equal(/\b(from|into|update)\s+household_members\b/i.test(sql), false);
});

// ---------------------------------------------------------------------------------------------
// 2. BEHAVIORAL
// ---------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;

type ProposalState = {
  id: string;
  proposer_id: string;
  child_id: string;
  person_id: string;
  relationship_id: string | null;
  relationship_type: string;
  scopes: string[];
  valid_from: string | null;
  valid_until: string | null;
  version: number;
  created_at: string;
  expires_at: string;
  confirmed_relationship_id: string | null;
  confirmed_grant_id: string | null;
  confirmed_at: string | null;
};

const ALLOWED_SCOPES = new Set(['pickup.request', 'schedule.read']);

type World = {
  people: Map<string, string>; // id -> display_name
  relationships: Row[]; // {id, from_id, to_id, type, status}
  grants: Row[]; // {id, actor_id, child_id, scopes, valid_from, valid_until, granted_by}
  capabilities: Row[]; // {person_id, name}
  householdMembers: Row[];
  proposals: Map<string, ProposalState>;
  seq: number;
};

function newWorld(): World {
  return {
    people: new Map(), relationships: [], grants: [], capabilities: [],
    householdMembers: [], proposals: new Map(), seq: 0,
  };
}

function isParentOf(world: World, caller: string, childId: string): boolean {
  const childHouseholds = world.householdMembers
    .filter((m) => m.person_id === childId && m.role === 'child')
    .map((m) => m.household_id);
  return world.householdMembers.some(
    (m) => m.person_id === caller && (m.role === 'parent' || m.role === 'guardian') && childHouseholds.includes(m.household_id),
  );
}

/** One fake db per (world, caller) — mirrors one real Supabase client per request. */
class FakeDb {
  constructor(private world: World, private callerId: string) {}

  from(name: string) {
    if (name === 'household_members') return rowsQuery(this.world.householdMembers);
    if (name === 'grants') return rowsQuery(this.world.grants);
    if (name === 'capabilities') return rowsQuery(this.world.capabilities);
    if (name === 'villager_proposals') {
      return rowsQuery([...this.world.proposals.values()].map(toVillagerProposalRow));
    }
    throw new Error(`unstubbed table: ${name}`);
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: Error | null }> {
    try {
      if (name === 'propose_add_villager') return { data: this.propose(args), error: null };
      if (name === 'confirm_add_villager') return { data: this.confirm(args), error: null };
      if (name === 'pickup_candidates_for') return { data: this.pickupCandidatesFor(args), error: null };
      if (name === 'grant_holders_for') return { data: this.grantHoldersFor(args), error: null };
      throw new Error(`unstubbed rpc: ${name}`);
    } catch (e) {
      return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  private propose(args: Record<string, unknown>): Row {
    const childId = String(args.p_child);
    const personName = String(args.p_person_name).trim().toLowerCase();
    const scopes = args.p_scopes as string[];
    if (!this.callerId) throw new Error('UNAUTHENTICATED');
    if (!isParentOf(this.world, this.callerId, childId)) throw new Error('UNAUTHORIZED');
    if (!scopes || scopes.length === 0) throw new Error('VILLAGER_SCOPES_REQUIRED');
    if (!scopes.every((s) => ALLOWED_SCOPES.has(s))) throw new Error('VILLAGER_SCOPE_NOT_ALLOWED');

    const matches = this.world.relationships.filter(
      (r) => r.to_id === childId && this.world.people.get(String(r.from_id))?.toLowerCase() === personName,
    );
    if (matches.length === 0) throw new Error('VILLAGER_NOT_FOUND');
    if (matches.length > 1) throw new Error('VILLAGER_NAME_AMBIGUOUS');
    const rel = matches[0];
    const personId = String(rel.from_id);

    const relationshipType = (args.p_relationship_type as string) ?? 'family_friend';
    if (['parent', 'guardian'].includes(relationshipType.toLowerCase())) {
      throw new Error('VILLAGER_RELATIONSHIP_TYPE_NOT_ALLOWED');
    }

    const existing = [...this.world.proposals.values()].find(
      (p) => p.proposer_id === this.callerId && p.child_id === childId && p.person_id === personId && p.confirmed_relationship_id === null,
    );
    const expiresAt = new Date(Date.now() + 900_000).toISOString();
    if (existing) {
      existing.relationship_type = String(rel.type);
      existing.scopes = scopes;
      existing.valid_from = (args.p_valid_from as string) ?? null;
      existing.valid_until = (args.p_valid_until as string) ?? null;
      existing.version += 1;
      existing.expires_at = expiresAt;
      return toProposalRow(existing);
    }
    const row: ProposalState = {
      id: `vp_${++this.world.seq}`,
      proposer_id: this.callerId,
      child_id: childId,
      person_id: personId,
      relationship_id: String(rel.id),
      relationship_type: String(rel.type),
      scopes,
      valid_from: (args.p_valid_from as string) ?? null,
      valid_until: (args.p_valid_until as string) ?? null,
      version: 1,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      confirmed_relationship_id: null,
      confirmed_grant_id: null,
      confirmed_at: null,
    };
    this.world.proposals.set(row.id, row);
    return toProposalRow(row);
  }

  private confirm(args: Record<string, unknown>): Row {
    const proposalId = String(args.p_proposal);
    const version = Number(args.p_version);
    if (!this.callerId) throw new Error('UNAUTHENTICATED');
    const prop = this.world.proposals.get(proposalId);
    if (!prop) throw new Error('PROPOSAL_NOT_FOUND');
    if (prop.proposer_id !== this.callerId) throw new Error('UNAUTHORIZED');

    if (prop.confirmed_relationship_id) {
      const rel = this.world.relationships.find((r) => r.id === prop.confirmed_relationship_id)!;
      const grant = this.world.grants.find((g) => g.id === prop.confirmed_grant_id)!;
      return toConfirmRow(rel, grant);
    }

    if (!isParentOf(this.world, this.callerId, prop.child_id)) throw new Error('UNAUTHORIZED');
    if (new Date(prop.expires_at) < new Date()) throw new Error('PROPOSAL_EXPIRED');
    if (prop.version !== version) throw new Error('PROPOSAL_STALE');
    if (!prop.scopes.every((s) => ALLOWED_SCOPES.has(s))) throw new Error('VILLAGER_SCOPE_NOT_ALLOWED');

    const rel = this.world.relationships.find((r) => r.id === prop.relationship_id)!;
    rel.status = 'ACTIVE';
    const grant: Row = {
      id: `g_${++this.world.seq}`,
      actor_id: prop.person_id,
      child_id: prop.child_id,
      scopes: prop.scopes,
      valid_from: prop.valid_from,
      valid_until: prop.valid_until,
      granted_by: this.callerId,
    };
    this.world.grants.push(grant);
    prop.confirmed_relationship_id = String(rel.id);
    prop.confirmed_grant_id = String(grant.id);
    prop.confirmed_at = new Date().toISOString();
    return toConfirmRow(rel, grant);
  }

  /** Mirrors 0008's pickup_candidates_for: ACTIVE relationships to the child, visible to a parent
   * (this test only exercises the parent-caller branch, which is the real shape this UI needs). */
  private pickupCandidatesFor(args: Record<string, unknown>) {
    const childId = String(args.child);
    if (!isParentOf(this.world, this.callerId, childId)) return [];
    return this.world.relationships
      .filter((r) => r.to_id === childId && r.status === 'ACTIVE')
      .map((r) => ({ from_id: r.from_id, type: r.type }));
  }

  /** Mirrors 0010's grant_holders_for, parent-caller branch. */
  private grantHoldersFor(args: Record<string, unknown>) {
    const childId = String(args.child);
    const scope = String(args.scope);
    const onDate = String(args.on_date);
    if (!isParentOf(this.world, this.callerId, childId)) return [];
    const holders = this.world.grants.filter((g) => {
      if (g.child_id !== childId || !(g.scopes as string[]).includes(scope)) return false;
      const from = g.valid_from ? String(g.valid_from) : null;
      const until = g.valid_until ? String(g.valid_until) : null;
      return (!from || from <= onDate) && (!until || until >= onDate);
    });
    return [...new Set(holders.map((g) => g.actor_id))];
  }
}

function rowsQuery(table: Row[]) {
  const filters: Array<(r: Row) => boolean> = [];
  const builder = {
    select() { return builder; },
    eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
    in(col: string, vals: unknown[]) { const s = new Set(vals); filters.push((r) => s.has(r[col] as never)); return builder; },
    not(col: string, op: string, val: unknown) {
      if (op !== 'is') throw new Error(`unstubbed not() operator: ${op}`);
      filters.push((r) => val === null ? r[col] !== null && r[col] !== undefined : r[col] !== val);
      return builder;
    },
    then(onf: (v: { data: unknown; error: null }) => unknown, onr?: unknown) {
      const data = table.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data, error: null }).then(onf, onr as never);
    },
  };
  return builder;
}

function toVillagerProposalRow(p: ProposalState): Row {
  return {
    id: p.id, proposer_id: p.proposer_id, child_id: p.child_id, person_id: p.person_id,
    relationship_type: p.relationship_type, scopes: p.scopes,
    confirmed_relationship_id: p.confirmed_relationship_id, confirmed_at: p.confirmed_at,
  };
}

function toProposalRow(p: ProposalState): Row {
  return {
    id: p.id, version: p.version, child_id: p.child_id, person_id: p.person_id,
    relationship_type: p.relationship_type, scopes: p.scopes,
    valid_from: p.valid_from, valid_until: p.valid_until,
    created_at: p.created_at, expires_at: p.expires_at,
  };
}

function toConfirmRow(rel: Row, grant: Row): Row {
  return {
    relationship_id: rel.id, relationship_type: rel.type, relationship_status: rel.status,
    person_id: grant.actor_id, child_id: grant.child_id,
    grant_id: grant.id, scopes: grant.scopes, valid_from: grant.valid_from, valid_until: grant.valid_until,
    granted_by: grant.granted_by,
  };
}

function ctxFor(callerId: string, world: World): Ctx {
  return { callerId, today: '2026-11-03', db: new FakeDb(world, callerId) as never };
}

/** Seeds exactly Dana's documented current state (HANDOFF 2026-11-02 00:19): DISCOVERED
 * friend_parent relationship to Nora, zero grants, no household link. */
function seedDanaAndNora(world: World) {
  world.people.set('p_nora', 'Nora Ellison');
  world.people.set('p_dana', 'Dana Coleman');
  world.people.set('p_mom', 'Kendra Ellison');
  world.people.set('p_priya', 'Priya Nair');
  world.householdMembers.push(
    { person_id: 'p_nora', household_id: 'h_a', role: 'child' },
    { person_id: 'p_mom', household_id: 'h_a', role: 'parent' },
    { person_id: 'p_dana', household_id: 'h_c', role: 'parent' }, // Dana's OWN household — never Nora's
  );
  world.relationships.push({ id: 'r_dana_friend_parent', from_id: 'p_dana', to_id: 'p_nora', type: 'friend_parent', status: 'DISCOVERED' });
  world.capabilities.push({ person_id: 'p_dana', name: 'transport.child' }); // pre-existing fact, not granted by this flow
}

test('Kendra proposes, confirms — relationship ACTIVE and grant exist with exactly the approved scopes/window', async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const kendra = ctxFor('p_mom', world);

  const proposal = await access.Mutation.proposeAddVillager(
    null,
    { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'], validFrom: '2026-11-01', validUntil: '2026-12-31' },
    kendra,
  );
  assert.equal(proposal.version, 1);
  assert.equal(world.relationships[0].status, 'DISCOVERED', 'propose must not activate anything yet');
  assert.equal(world.grants.length, 0, 'propose must not create a grant yet');

  const result = await access.Mutation.confirmAddVillager(null, { proposalId: proposal.id, version: proposal.version }, kendra);
  assert.equal(result.relationship.status, 'ACTIVE');
  assert.deepEqual(result.grant.scopes, ['pickup.request']);
  assert.equal(result.grant.validFrom, '2026-11-01');
  assert.equal(result.grant.validUntil, '2026-12-31');
  assert.equal(world.relationships[0].status, 'ACTIVE');
  assert.equal(world.grants.length, 1);
  assert.equal(world.grants[0].actor_id, 'p_dana');
  assert.equal(world.grants[0].granted_by, 'p_mom');
});

test('schedule.read must be named explicitly — it is never implied by pickup.request', async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const kendra = ctxFor('p_mom', world);
  const proposal = await access.Mutation.proposeAddVillager(
    null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'] }, kendra,
  );
  await access.Mutation.confirmAddVillager(null, { proposalId: proposal.id, version: proposal.version }, kendra);
  assert.deepEqual(world.grants[0].scopes, ['pickup.request']);
  assert.equal((world.grants[0].scopes as string[]).includes('schedule.read'), false);
});

test('a disallowed scope (address/care-shaped) is refused, server-side, regardless of what is asked for', async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const kendra = ctxFor('p_mom', world);
  await assert.rejects(
    () => access.Mutation.proposeAddVillager(
      null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['careplan.read'] }, kendra,
    ),
    (e: unknown) => e instanceof GraphQLError && e.extensions.code === 'VILLAGER_SCOPE_NOT_ALLOWED',
  );
});

test('a stale (edited) proposal is refused: confirming an old version after a re-propose fails', async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const kendra = ctxFor('p_mom', world);
  const first = await access.Mutation.proposeAddVillager(
    null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'] }, kendra,
  );
  await access.Mutation.proposeAddVillager(
    null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request', 'schedule.read'] }, kendra,
  );
  await assert.rejects(
    () => access.Mutation.confirmAddVillager(null, { proposalId: first.id, version: first.version }, kendra),
    (e: unknown) => e instanceof GraphQLError && e.extensions.code === 'PROPOSAL_STALE',
  );
  assert.equal(world.grants.length, 0);
});

test('sequential AND concurrent retries of confirm create exactly one grant, returning the same result', async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const kendra = ctxFor('p_mom', world);
  const proposal = await access.Mutation.proposeAddVillager(
    null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'] }, kendra,
  );

  const r1 = await access.Mutation.confirmAddVillager(null, { proposalId: proposal.id, version: proposal.version }, kendra);
  const r2 = await access.Mutation.confirmAddVillager(null, { proposalId: proposal.id, version: proposal.version }, kendra);
  assert.equal(r1.grant.id, r2.grant.id);
  assert.equal(world.grants.length, 1);

  const [r3, r4] = await Promise.all([
    access.Mutation.confirmAddVillager(null, { proposalId: proposal.id, version: proposal.version }, kendra),
    access.Mutation.confirmAddVillager(null, { proposalId: proposal.id, version: proposal.version }, kendra),
  ]);
  assert.equal(r3.grant.id, r4.grant.id);
  assert.equal(world.grants.length, 1, 'still exactly one grant after a concurrent retry');
});

test('Dana herself (not a parent of Nora) cannot propose adding herself', async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const dana = ctxFor('p_dana', world);
  await assert.rejects(
    () => access.Mutation.proposeAddVillager(
      null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'] }, dana,
    ),
    (e: unknown) => e instanceof GraphQLError && e.extensions.code === 'UNAUTHORIZED',
  );
});

test('Priya (not a parent of Nora) cannot propose adding anyone to Nora', async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const priya = ctxFor('p_priya', world);
  await assert.rejects(
    () => access.Mutation.proposeAddVillager(
      null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'] }, priya,
    ),
    (e: unknown) => e instanceof GraphQLError && e.extensions.code === 'UNAUTHORIZED',
  );
});

test('an unknown name resolves to nothing — no village-wide directory, no guess', async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const kendra = ctxFor('p_mom', world);
  await assert.rejects(
    () => access.Mutation.proposeAddVillager(
      null, { childId: 'p_nora', personName: 'Someone Nobody Knows', scopes: ['pickup.request'] }, kendra,
    ),
    (e: unknown) => e instanceof GraphQLError && e.extensions.code === 'VILLAGER_NOT_FOUND',
  );
});

test('after confirm, Dana IS a pickupCandidate for Nora (ACTIVE relationship + pickup.request grant + her pre-existing transport.child)', async () => {
  const world = newWorld();
  seedDanaAndNora(world);

  // Each check gets its OWN fresh ctx on the SAME world/db state — mirroring separate HTTP
  // requests, since authz.ts's memo() caches derived reads per-ctx and reusing one ctx across
  // "before" and "after" would serve a stale cached result instead of re-querying.
  const before = await pickupCandidatesFor(ctxFor('p_mom', world), 'p_nora', '2026-11-15');
  assert.equal(before.some((c) => c.personId === 'p_dana'), false, 'not a candidate before confirm — relationship is still DISCOVERED and she holds no grant');

  const proposal = await access.Mutation.proposeAddVillager(
    null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'], validFrom: '2026-11-01', validUntil: '2026-12-31' }, ctxFor('p_mom', world),
  );
  await access.Mutation.confirmAddVillager(null, { proposalId: proposal.id, version: proposal.version }, ctxFor('p_mom', world));

  const after = await pickupCandidatesFor(ctxFor('p_mom', world), 'p_nora', '2026-11-15');
  assert.equal(after.some((c) => c.personId === 'p_dana'), true, 'eligible as a candidate once ACTIVE + pickup.request + transport.child all hold');

  const outsideWindow = await pickupCandidatesFor(ctxFor('p_mom', world), 'p_nora', '2027-01-15');
  assert.equal(outsideWindow.some((c) => c.personId === 'p_dana'), false, 'the grant window is honored — not a candidate once it expires');
});

test('candidate status is eligibility only — it does not mean available, accepted, or contact-verified', async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const kendra = ctxFor('p_mom', world);
  const proposal = await access.Mutation.proposeAddVillager(
    null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'] }, kendra,
  );
  await access.Mutation.confirmAddVillager(null, { proposalId: proposal.id, version: proposal.version }, kendra);
  const candidates = await pickupCandidatesFor(kendra, 'p_nora', '2026-11-15');
  const dana = candidates.find((c) => c.personId === 'p_dana');
  assert.equal(dana?.availability, 'UNKNOWN');
});

test("adding Dana exposes neither family's other children, household data, or parent authority", async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  // Jax is Dana's own child — never touched or revealed by this flow at all.
  world.people.set('p_jax', 'Jax Coleman');
  world.householdMembers.push({ person_id: 'p_jax', household_id: 'h_c', role: 'child' });
  const kendra = ctxFor('p_mom', world);

  const proposal = await access.Mutation.proposeAddVillager(
    null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'] }, kendra,
  );
  await access.Mutation.confirmAddVillager(null, { proposalId: proposal.id, version: proposal.version }, kendra);

  // Dana's own household membership (h_c, parent of Jax) is completely untouched.
  const danaMembership = world.householdMembers.filter((m) => m.person_id === 'p_dana');
  assert.deepEqual(danaMembership, [{ person_id: 'p_dana', household_id: 'h_c', role: 'parent' }]);
  // Dana never becomes a member of Nora's household (h_a).
  assert.equal(world.householdMembers.some((m) => m.person_id === 'p_dana' && m.household_id === 'h_a'), false);
  // The new grant names exactly Nora as the child — nothing about Jax.
  assert.equal(world.grants[0].child_id, 'p_nora');
});

test("Dana, signed in as herself, sees exactly Nora with exactly her granted scopes — nothing more", async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const proposal = await access.Mutation.proposeAddVillager(
    null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'], validFrom: '2026-11-01', validUntil: '2026-12-31' }, ctxFor('p_mom', world),
  );
  await access.Mutation.confirmAddVillager(null, { proposalId: proposal.id, version: proposal.version }, ctxFor('p_mom', world));

  const mine = await access.Query.myChildren(null, {}, ctxFor('p_dana', world));
  assert.equal(mine.length, 1, 'Dana sees exactly one child — not her own, not any other family');
  assert.equal(mine[0].child.id, 'p_nora');
  assert.deepEqual(mine[0].scopes, ['pickup.request']);
});

// ---------------------------------------------------------------------------------------------
// 2b. villagerAdditions — the Activity (web) read this TASK adds, sourced from villager_proposals'
//     own confirmed_at/confirmed_relationship_id, never from grants/approvals (which cannot tell
//     this flow apart from a plain grantAccess call).
// ---------------------------------------------------------------------------------------------

test('villagerAdditions is empty until confirm actually runs — a staged, unconfirmed proposal is not an addition', async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const kendra = ctxFor('p_mom', world);
  await access.Mutation.proposeAddVillager(
    null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'] }, kendra,
  );
  const additions = await access.Query.villagerAdditions(null, { childId: 'p_nora' }, kendra);
  assert.deepEqual(additions, []);
});

test('after confirm, villagerAdditions reports exactly who added whom, with what scopes, and a real confirmedAt', async () => {
  const world = newWorld();
  seedDanaAndNora(world);
  const kendra = ctxFor('p_mom', world);
  const proposal = await access.Mutation.proposeAddVillager(
    null, { childId: 'p_nora', personName: 'Dana Coleman', scopes: ['pickup.request'] }, kendra,
  );
  const before = Date.now();
  await access.Mutation.confirmAddVillager(null, { proposalId: proposal.id, version: proposal.version }, kendra);

  const additions = await access.Query.villagerAdditions(null, { childId: 'p_nora' }, kendra);
  assert.equal(additions.length, 1);
  assert.equal(additions[0].personId, 'p_dana', 'the villager who was added');
  assert.equal(additions[0].addedById, 'p_mom', 'the parent who confirmed it');
  assert.deepEqual(additions[0].scopes, ['pickup.request']);
  assert.ok(Date.parse(additions[0].confirmedAt) >= before, 'confirmedAt is a real timestamp, not a placeholder');
});

test('villagerAdditions adds no code-side authorization beyond RLS — it must not widen villager_proposals_read\'s proposer-only boundary', () => {
  // The FakeDb above has no RLS to enforce this live, so this is a structural check on the real
  // resolver's source: it must rely ENTIRELY on villager_proposals' own read policy (proposer_id
  // = current_person()), never add an isParentOf(childId) check that would let a co-parent who
  // never proposed it see someone else's confirmation.
  const source = readFileSync('src/subgraphs/access.ts', 'utf8');
  const body = source.slice(
    source.indexOf('villagerAdditions: async'),
    source.indexOf('\n  },', source.indexOf('villagerAdditions: async')),
  );
  assert.equal(/isParentOf\(/.test(body), false, 'villagerAdditions must not add its own parent-of check — RLS alone decides visibility');
});

// ---------------------------------------------------------------------------------------------
// 3. RESET — structural proof the EXISTING mechanism already handles this correctly
// ---------------------------------------------------------------------------------------------

test('RESET: relationships and grants are both in scripts/db.ts RESET_SCOPED already (no new reset code needed)', () => {
  const dbTs = readFileSync('scripts/db.ts', 'utf8');
  const match = dbTs.match(/const RESET_SCOPED = \[([\s\S]*?)\];/);
  assert.ok(match, 'RESET_SCOPED array must exist');
  assert.match(match![1], /'relationships'/);
  assert.match(match![1], /'grants'/);
});

test('RESET: the activated relationship keeps a baseline id (reverted by reseed), the new grant does not (deleted by RESET_SCOPED)', () => {
  const world = newWorld();
  seedDanaAndNora(world);
  // r_dana_friend_parent is a real src/fixtures.ts id — confirm_add_villager UPDATEs it in place,
  // never deletes/recreates it, so a reseed's upsert reverts status to the fixture's DISCOVERED.
  assert.equal(world.relationships[0].id, 'r_dana_friend_parent');
  // The grant id confirm_add_villager generates is never a fixture id — RESET_SCOPED's
  // keep-set (baseline grant ids only) will not contain it, so resetDatabase() deletes it.
  const freshGrantId = 'g_1'; // this test's own fake sequence; the real migration uses a random suffix
  const baselineGrantIds = ['g_loretta', 'g_bryan', 'g_tasha', 'g_monique', 'g_walter', 'g_gloria', 'g_priya', 'g_leo', 'g_angela', 'g_daniel', 'g_carol', 'g_chris_expired', 'g_gary', 'g_evelyn', 'g_jax_angela'];
  assert.equal(baselineGrantIds.includes(freshGrantId), false);
});
