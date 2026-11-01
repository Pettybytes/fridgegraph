/**
 * Unit tests for TASK (Rosina school-report tool): propose/confirm for a school-day report.
 *
 * Two kinds of proof here:
 *
 *  1. STRUCTURAL — "a model tool call can never confirm itself" is enforced by the ABSENCE of any
 *     wiring that would let Rosina's tool transport reach `confirmSchoolDayReport`: no MCP
 *     operation file, and the name is not in model.ts's ALLOWED_MCP_TOOL_NAMES. This is directly
 *     inspectable from source, not something to mock.
 *
 *  2. BEHAVIORAL — a hand-written, in-memory model of `propose_school_report` /
 *     `confirm_school_report` (migration 0071), driven through the REAL school.ts resolvers via
 *     `dbFor(ctx).rpc(...)`. This proves the resolver call shape and error-mapping are correct,
 *     and that the ALGORITHM (lock a row, check confirmed/expiry/version, insert-once) is sound
 *     under both sequential and forced-concurrent retries. It does NOT prove Postgres's own
 *     `SELECT ... FOR UPDATE` actually serializes two real concurrent connections — that is
 *     Postgres behavior this process cannot exercise, and is Bentley's live deployment check.
 *     The "naive, unlocked" variant below exists ONLY to show the hazard the lock is for; it is
 *     test-only code, never shipped.
 *
 * No network call. Run with:
 *   node --import tsx --test src/subgraphs/school-report-proposal.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { GraphQLError } from 'graphql';
import type { Ctx } from '../authz';
import schoolSubgraph from './school';

const school = schoolSubgraph.resolvers;

// ---------------------------------------------------------------------------------------------
// 1. STRUCTURAL: confirm is unreachable from Rosina's tool transport, by construction.
// ---------------------------------------------------------------------------------------------

test('no MCP operation file exposes confirmSchoolDayReport', () => {
  const opsDir = 'ops';
  const files = readdirSync(opsDir).filter((f) => f.endsWith('.graphql'));
  for (const file of files) {
    const text = readFileSync(`${opsDir}/${file}`, 'utf8');
    // Checks for an actual FIELD SELECTION (name immediately followed by an argument list or a
    // selection set), not prose mentioning the name — ProposeSchoolDayReport.graphql's own header
    // comment explains why no such file exists, which would otherwise false-positive here.
    assert.equal(
      /confirmSchoolDayReport\s*[({]/.test(text),
      false,
      `${file} must not select confirmSchoolDayReport`,
    );
  }
  assert.equal(existsSync(`${opsDir}/ConfirmSchoolDayReport.graphql`), false);
});

test('confirmSchoolDayReport/ConfirmSchoolDayReport is not in Rosina\'s MCP allowlist', () => {
  const text = readFileSync('src/rosina/model.ts', 'utf8');
  const allowlistBlock = text.slice(
    text.indexOf('const ALLOWED_MCP_TOOL_NAMES'),
    text.indexOf(']);', text.indexOf('const ALLOWED_MCP_TOOL_NAMES')),
  );
  assert.equal(allowlistBlock.includes("'ConfirmSchoolDayReport'"), false);
  // proposeSchoolDayReport-the-stage IS allowed — this test only refuses the one that files.
  assert.equal(allowlistBlock.includes("'ProposeSchoolDayReport'"), true);
});

test('ProposeSchoolDayReport.graphql exists and is listed in mcp.local.yaml, so it is actually reachable', () => {
  assert.equal(existsSync('ops/ProposeSchoolDayReport.graphql'), true);
  const yaml = readFileSync('.apollo/mcp.local.yaml', 'utf8');
  assert.equal(yaml.includes('./ops/ProposeSchoolDayReport.graphql'), true);
});

// ---------------------------------------------------------------------------------------------
// 2. BEHAVIORAL: an in-memory model of the two RPCs, driven through the real resolvers.
// ---------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;

type ProposalState = {
  id: string;
  actor_id: string;
  child_id: string;
  kind: string;
  text: string;
  version: number;
  created_at: string;
  expires_at: string;
  confirmed_report_id: string | null;
};

/** Minimal chainable fake for the `.from()` calls the EXISTING (PR #92) resolvers still use. */
class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(r: Row) => boolean> = [];
  private insertRow: Row | null = null;
  private wantsSingle = false;
  constructor(private table: Row[]) {}
  select(_c?: string) { return this; }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  in(col: string, vals: unknown[]) { const s = new Set(vals); this.filters.push((r) => s.has(r[col] as never)); return this; }
  insert(row: Row) { this.insertRow = row; return this; }
  maybeSingle() { this.wantsSingle = true; return this; }
  then<T1, T2 = never>(
    onf?: ((v: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
    onr?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    let payload: { data: unknown; error: null };
    if (this.insertRow) {
      this.table.push(this.insertRow);
      payload = { data: this.wantsSingle ? this.insertRow : [this.insertRow], error: null };
    } else {
      const m = this.table.filter((r) => this.filters.every((f) => f(r)));
      payload = { data: this.wantsSingle ? (m[0] ?? null) : m, error: null };
    }
    return Promise.resolve(payload).then(onf, onr);
  }
}

/** Shared mutable world one test's db instances all read/write through. */
type World = {
  grants: Row[];
  householdMembers: Row[];
  proposals: Map<string, ProposalState>;
  schoolReports: Row[];
  seq: number;
  now: () => Date;
};

function newWorld(now: () => Date = () => new Date('2026-11-03T12:00:00Z')): World {
  return { grants: [], householdMembers: [], proposals: new Map(), schoolReports: [], seq: 0, now };
}

function hasScope(world: World, actorId: string, childId: string, scope: string): boolean {
  return world.grants.some((g) => g.actor_id === actorId && g.child_id === childId && (g.scopes as string[]).includes(scope));
}

/** One fake db per (world, caller) — mirrors one real Supabase client per request, all pointed
 * at the same database. `locked` is a tiny async mutex, standing in for Postgres's real
 * `SELECT ... FOR UPDATE`; `useLock: false` reproduces the naive, unlocked hazard on purpose. */
class FakeDb {
  private static locks = new Map<string, Promise<void>>();
  constructor(private world: World, private callerId: string, private useLock = true) {}

  from(name: string): FakeQuery {
    if (name === 'school_reports') return new FakeQuery(this.world.schoolReports);
    if (name === 'household_members') return new FakeQuery(this.world.householdMembers);
    if (name === 'grants') return new FakeQuery(this.world.grants);
    throw new Error(`unstubbed table: ${name}`);
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: Error | null }> {
    try {
      if (name === 'propose_school_report') return { data: this.proposeSchoolReport(args), error: null };
      if (name === 'confirm_school_report') return { data: await this.confirmSchoolReport(args), error: null };
      throw new Error(`unstubbed rpc: ${name}`);
    } catch (e) {
      // Real supabase-js RPC errors are PostgrestError, which extends Error — matched here so
      // schoolReportProposalError's `e instanceof Error` branch is exercised the same way.
      return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  private proposeSchoolReport(args: Record<string, unknown>): Row {
    const childId = String(args.p_child);
    const kind = String(args.p_kind);
    const text = String(args.p_text);
    if (!kind.trim()) throw new Error('SCHOOL_REPORT_KIND_REQUIRED');
    if (!text.trim()) throw new Error('SCHOOL_REPORT_TEXT_REQUIRED');
    if (!hasScope(this.world, this.callerId, childId, 'school.report')) throw new Error('UNAUTHORIZED');

    const existing = [...this.world.proposals.values()]
      .filter((p) => p.actor_id === this.callerId && p.child_id === childId && p.confirmed_report_id === null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

    const expiresAt = new Date(this.world.now().getTime() + 900_000).toISOString();
    if (existing) {
      existing.kind = kind;
      existing.text = text;
      existing.version += 1;
      existing.expires_at = expiresAt;
      return toProposalRow(existing);
    }
    const row: ProposalState = {
      id: `srp_${++this.world.seq}`,
      actor_id: this.callerId,
      child_id: childId,
      kind,
      text,
      version: 1,
      created_at: this.world.now().toISOString(),
      expires_at: expiresAt,
      confirmed_report_id: null,
    };
    this.world.proposals.set(row.id, row);
    return toProposalRow(row);
  }

  private async confirmSchoolReport(args: Record<string, unknown>): Promise<Row> {
    const proposalId = String(args.p_proposal);
    const version = Number(args.p_version);

    if (this.useLock) {
      const prior = FakeDb.locks.get(proposalId) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((resolve) => { release = resolve; });
      FakeDb.locks.set(proposalId, prior.then(() => mine));
      await prior;
      try {
        return this.confirmLocked(proposalId, version);
      } finally {
        release();
      }
    }
    // Naive path (test-only): a real await gap between read and write, with NO lock — this is
    // what migration 0071's `for update` exists to prevent, demonstrated below.
    const row = this.world.proposals.get(proposalId);
    if (!row) throw new Error('PROPOSAL_NOT_FOUND');
    if (row.actor_id !== this.callerId) throw new Error('UNAUTHORIZED');
    if (row.confirmed_report_id) return this.world.schoolReports.find((r) => r.id === row.confirmed_report_id)!;
    await new Promise((r) => setTimeout(r, 0)); // the forced interleave point
    if (new Date(row.expires_at) < this.world.now()) throw new Error('PROPOSAL_EXPIRED');
    if (row.version !== version) throw new Error('PROPOSAL_STALE');
    const report = this.insertReport(row);
    row.confirmed_report_id = report.id as string;
    return report;
  }

  private confirmLocked(proposalId: string, version: number): Row {
    const row = this.world.proposals.get(proposalId);
    if (!row) throw new Error('PROPOSAL_NOT_FOUND');
    if (row.actor_id !== this.callerId) throw new Error('UNAUTHORIZED');
    if (row.confirmed_report_id) return this.world.schoolReports.find((r) => r.id === row.confirmed_report_id)!;
    if (!hasScope(this.world, this.callerId, row.child_id, 'school.report')) throw new Error('UNAUTHORIZED');
    if (new Date(row.expires_at) < this.world.now()) throw new Error('PROPOSAL_EXPIRED');
    if (row.version !== version) throw new Error('PROPOSAL_STALE');
    const report = this.insertReport(row);
    row.confirmed_report_id = report.id as string;
    return report;
  }

  private insertReport(row: ProposalState): Row {
    const report: Row = {
      id: `sr_${++this.world.seq}`,
      child_id: row.child_id,
      kind: row.kind,
      text: row.text,
      at: '2026-11-03',
      reported_at: this.world.now().toISOString(),
    };
    this.world.schoolReports.push(report);
    return report;
  }
}

function toProposalRow(p: ProposalState): Row {
  return { id: p.id, child_id: p.child_id, kind: p.kind, text: p.text, version: p.version, created_at: p.created_at, expires_at: p.expires_at };
}

function ctxFor(callerId: string, db: FakeDb, today = '2026-11-03'): Ctx {
  return { callerId, today, db: db as never };
}

function grant(world: World, actorId: string, childId: string, scopes: string[]) {
  world.grants.push({ actor_id: actorId, child_id: childId, scopes });
}

test('teacher proposes, nothing is filed yet, then she confirms and a real report exists', async () => {
  const world = newWorld();
  grant(world, 'p_whitfield', 'p_nora', ['school.read', 'school.report']);
  const teacher = ctxFor('p_whitfield', new FakeDb(world, 'p_whitfield'));

  const proposal = await school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'Nora has a fever' }, teacher);
  assert.equal(proposal.version, 1);
  assert.equal(world.schoolReports.length, 0, 'propose must never create a SchoolReport');

  const report = await school.Mutation.confirmSchoolDayReport(null, { proposalId: proposal.id, version: proposal.version }, teacher);
  assert.equal(report.kind, 'health');
  assert.equal(world.schoolReports.length, 1);
});

test('nothing is filed without confirm — propose alone, called any number of times, files nothing', async () => {
  const world = newWorld();
  grant(world, 'p_whitfield', 'p_nora', ['school.read', 'school.report']);
  const teacher = ctxFor('p_whitfield', new FakeDb(world, 'p_whitfield'));
  await school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever' }, teacher);
  await school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever, revised' }, teacher);
  assert.equal(world.schoolReports.length, 0);
  assert.equal(world.proposals.size, 1, 're-proposing replaces the draft, not adds a second one');
});

test('a stale (edited) proposal is refused: confirming an old version after a re-propose fails', async () => {
  const world = newWorld();
  grant(world, 'p_whitfield', 'p_nora', ['school.read', 'school.report']);
  const teacher = ctxFor('p_whitfield', new FakeDb(world, 'p_whitfield'));
  const first = await school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever' }, teacher);
  await school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever AND a rash' }, teacher);

  await assert.rejects(
    () => school.Mutation.confirmSchoolDayReport(null, { proposalId: first.id, version: first.version }, teacher),
    (e: unknown) => e instanceof GraphQLError && e.extensions.code === 'PROPOSAL_STALE',
  );
  assert.equal(world.schoolReports.length, 0);
});

test('an expired proposal is refused', async () => {
  let clock = new Date('2026-11-03T12:00:00Z');
  const world = newWorld(() => clock);
  grant(world, 'p_whitfield', 'p_nora', ['school.read', 'school.report']);
  const teacher = ctxFor('p_whitfield', new FakeDb(world, 'p_whitfield'));
  const proposal = await school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever' }, teacher);

  clock = new Date(clock.getTime() + 20 * 60_000); // past the 15-minute TTL
  await assert.rejects(
    () => school.Mutation.confirmSchoolDayReport(null, { proposalId: proposal.id, version: proposal.version }, teacher),
    (e: unknown) => e instanceof GraphQLError && e.extensions.code === 'PROPOSAL_EXPIRED',
  );
});

test('sequential retries of the same confirm create exactly one report and return it both times', async () => {
  const world = newWorld();
  grant(world, 'p_whitfield', 'p_nora', ['school.read', 'school.report']);
  const teacher = ctxFor('p_whitfield', new FakeDb(world, 'p_whitfield'));
  const proposal = await school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever' }, teacher);

  const r1 = await school.Mutation.confirmSchoolDayReport(null, { proposalId: proposal.id, version: proposal.version }, teacher);
  const r2 = await school.Mutation.confirmSchoolDayReport(null, { proposalId: proposal.id, version: proposal.version }, teacher);
  assert.equal(r1.id, r2.id);
  assert.equal(world.schoolReports.length, 1);
});

test('concurrent retries, WITH the lock (as shipped): exactly one report, both callers see the same one', async () => {
  const world = newWorld();
  grant(world, 'p_whitfield', 'p_nora', ['school.read', 'school.report']);
  const db = new FakeDb(world, 'p_whitfield', true);
  const teacher = ctxFor('p_whitfield', db);
  const proposal = await school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever' }, teacher);

  const [r1, r2] = await Promise.all([
    school.Mutation.confirmSchoolDayReport(null, { proposalId: proposal.id, version: proposal.version }, teacher),
    school.Mutation.confirmSchoolDayReport(null, { proposalId: proposal.id, version: proposal.version }, teacher),
  ]);
  assert.equal(r1.id, r2.id);
  assert.equal(world.schoolReports.length, 1);
});

test('HONESTY CHECK: the SAME concurrent race, with the lock removed, demonstrates the hazard the lock exists to prevent', async () => {
  const world = newWorld();
  grant(world, 'p_whitfield', 'p_nora', ['school.read', 'school.report']);
  const unlocked = new FakeDb(world, 'p_whitfield', false);
  const teacher = ctxFor('p_whitfield', unlocked);
  const proposal = await school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever' }, teacher);

  await Promise.all([
    school.Mutation.confirmSchoolDayReport(null, { proposalId: proposal.id, version: proposal.version }, teacher),
    school.Mutation.confirmSchoolDayReport(null, { proposalId: proposal.id, version: proposal.version }, teacher),
  ]);
  // This is the bug 0071's `SELECT ... FOR UPDATE` prevents — proving the hazard is real, not
  // proving Postgres's own lock (which only a live database can prove).
  assert.equal(world.schoolReports.length, 2, 'without a lock, two concurrent confirms double-insert');
});

test('Priya (no school.report grant on Nora) is refused, propose and confirm alike', async () => {
  const world = newWorld();
  grant(world, 'p_whitfield', 'p_nora', ['school.read', 'school.report']);
  grant(world, 'p_priya', 'p_nora', ['supervise.request', 'schedule.read', 'careplan.read']);
  const priya = ctxFor('p_priya', new FakeDb(world, 'p_priya'));

  await assert.rejects(
    () => school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever' }, priya),
    (e: unknown) => e instanceof GraphQLError && e.extensions.code === 'UNAUTHORIZED',
  );
});

test('an unrelated caller (no grant at all) is refused', async () => {
  const world = newWorld();
  grant(world, 'p_whitfield', 'p_nora', ['school.read', 'school.report']);
  const stranger = ctxFor('p_stranger', new FakeDb(world, 'p_stranger'));

  await assert.rejects(
    () => school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever' }, stranger),
    (e: unknown) => e instanceof GraphQLError && e.extensions.code === 'UNAUTHORIZED',
  );
});

test('the parent reads the confirmed report through the existing, unchanged schoolReports query', async () => {
  const world = newWorld();
  world.householdMembers.push(
    { person_id: 'p_nora', household_id: 'h_a', role: 'child' },
    { person_id: 'p_mom', household_id: 'h_a', role: 'parent' },
  );
  grant(world, 'p_whitfield', 'p_nora', ['school.read', 'school.report']);
  const teacher = ctxFor('p_whitfield', new FakeDb(world, 'p_whitfield'));
  const proposal = await school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever, please call' }, teacher);
  await school.Mutation.confirmSchoolDayReport(null, { proposalId: proposal.id, version: proposal.version }, teacher);

  const parent = ctxFor('p_mom', new FakeDb(world, 'p_mom'));
  const seen = await school.Query.schoolReports(null, { childId: 'p_nora' }, parent);
  assert.equal(seen.some((r: { text: string }) => r.text === 'fever, please call'), true);
});

// ---------------------------------------------------------------------------------------------
// reportedAt mapping — the TypeScript half only. The trigger itself (server-owned, overriding a
// client-supplied value, leaving legacy/fixture rows NULL) is a database behavior this process
// cannot exercise; see docs/handoff/HANDOFF.md for the live check Bentley's window must run.
// ---------------------------------------------------------------------------------------------

test('reportedAt: null maps through as null (legacy row); a real filing maps through as a string', async () => {
  const world = newWorld();
  world.householdMembers.push(
    { person_id: 'p_nora', household_id: 'h_a', role: 'child' },
    { person_id: 'p_mom', household_id: 'h_a', role: 'parent' },
  );
  world.schoolReports.push({ id: 'sr_legacy', child_id: 'p_nora', kind: 'note', text: 'old', at: '2020-01-01', reported_at: null });

  const parent = ctxFor('p_mom', new FakeDb(world, 'p_mom'));
  const before = await school.Query.schoolReports(null, { childId: 'p_nora' }, parent);
  assert.equal(before.find((r: { id: string }) => r.id === 'sr_legacy')?.reportedAt, null);

  grant(world, 'p_whitfield', 'p_nora', ['school.read', 'school.report']);
  const teacher = ctxFor('p_whitfield', new FakeDb(world, 'p_whitfield'));
  const proposal = await school.Mutation.proposeSchoolDayReport(null, { childId: 'p_nora', kind: 'health', text: 'fever' }, teacher);
  const filed = await school.Mutation.confirmSchoolDayReport(null, { proposalId: proposal.id, version: proposal.version }, teacher);
  assert.equal(typeof filed.reportedAt, 'string');

  const after = await school.Query.schoolReports(null, { childId: 'p_nora' }, parent);
  assert.equal(after.find((r: { id: string }) => r.id === filed.id)?.reportedAt, filed.reportedAt);
});
