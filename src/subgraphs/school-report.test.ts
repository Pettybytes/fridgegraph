/**
 * Unit tests for TASK (teacher persona): Ms. Whitfield's own caller identity against the real
 * authorization code in src/authz.ts, src/subgraphs/school.ts and src/subgraphs/access.ts.
 *
 * A fake, in-memory Postgres-shaped client stands in for dbFor(ctx) (set directly on ctx.db, which
 * dbFor() returns before it would need a token or env var — see src/db.ts). This exercises the
 * APPLICATION layer exactly as the resolvers call it. It does NOT exercise Postgres RLS itself
 * (migration 0070's school_reports_insert policy, has_scope(), FORCE ROW LEVEL SECURITY) — that
 * half is unproven until Bentley applies 0070 and runs a live proof against the real database.
 *
 * No network call. Run with:
 *   node --import tsx --test src/subgraphs/school-report.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GraphQLError } from 'graphql';
import { SCOPE, authorizeChild, hasScope, type Ctx } from '../authz';
import schoolSubgraph from './school';
import accessSubgraph from './access';
import { createCastV2 } from '../fixtures-cast-v2';

type Row = Record<string, unknown>;

/** Minimal fake of the chainable subset of supabase-js actually used by authz.ts / school.ts. */
class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(r: Row) => boolean> = [];
  private insertRow: Row | null = null;
  private wantsSingle = false;

  constructor(private table: Row[]) {}

  select(_cols?: string) {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    const set = new Set(vals);
    this.filters.push((r) => set.has(r[col] as never));
    return this;
  }
  insert(row: Row) {
    this.insertRow = row;
    return this;
  }
  maybeSingle() {
    this.wantsSingle = true;
    return this;
  }

  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let payload: { data: unknown; error: null };
    if (this.insertRow) {
      this.table.push(this.insertRow);
      payload = { data: this.wantsSingle ? this.insertRow : [this.insertRow], error: null };
    } else {
      const matched = this.table.filter((r) => this.filters.every((f) => f(r)));
      payload = { data: this.wantsSingle ? (matched[0] ?? null) : matched, error: null };
    }
    return Promise.resolve(payload).then(onfulfilled, onrejected);
  }
}

class FakeDb {
  constructor(private tables: Record<string, Row[]>) {}
  from(name: string) {
    if (!this.tables[name]) this.tables[name] = [];
    return new FakeQuery(this.tables[name]);
  }
}

/** The exact slice of the real household/grant graph this test needs, hand-matched to fixtures. */
function seedTables(): Record<string, Row[]> {
  return {
    household_members: [
      { person_id: 'p_nora', household_id: 'h_a', role: 'child' },
      { person_id: 'p_mom', household_id: 'h_a', role: 'parent' },
      { person_id: 'p_jax', household_id: 'h_c', role: 'child' },
      { person_id: 'p_dana', household_id: 'h_c', role: 'parent' },
    ],
    grants: [
      { id: 'g_whitfield_school', actor_id: 'p_whitfield', child_id: 'p_nora',
        scopes: ['school.read', 'school.report'], valid_from: null, valid_until: null, granted_by: 'p_mom' },
    ],
    school_reports: [],
  };
}

function ctxFor(callerId: string, db: FakeDb): Ctx {
  return { callerId, today: '2026-11-03', db: db as never };
}

const school = schoolSubgraph.resolvers;
const access = accessSubgraph.resolvers;

test('teacher reads Nora\'s school-day reports (school.read grant)', async () => {
  const db = new FakeDb(seedTables());
  const teacher = ctxFor('p_whitfield', db);
  const out = await school.Query.schoolReports(null, { childId: 'p_nora' }, teacher);
  assert.deepEqual(out, []); // no reports filed yet — proves the read path works, not just "didn't throw"
});

test('teacher files a fever report, and it is a real persisted row — the parent then reads it back', async () => {
  const tables = seedTables();
  const db = new FakeDb(tables);
  const teacher = ctxFor('p_whitfield', db);

  const report = await school.Mutation.reportSchoolDay(
    null,
    { childId: 'p_nora', kind: 'health', text: 'Nora has a fever, sent to the office' },
    teacher,
  );
  assert.equal(report.child.id, 'p_nora');
  assert.equal(report.kind, 'health');
  assert.ok(report.id.startsWith('sr_'));

  // The underlying table actually has the row (a chat acknowledgement would not).
  assert.equal(tables.school_reports.length, 1);
  assert.equal(tables.school_reports[0].text, 'Nora has a fever, sent to the office');

  // Kendra (Nora's mom) is a parent — authorizeChild('parent') — and reads it on the SAME db.
  const kendra = ctxFor('p_mom', db);
  const parentView = await school.Query.schoolReports(null, { childId: 'p_nora' }, kendra);
  assert.equal(parentView.length, 1);
  assert.equal(parentView[0].id, report.id);
  assert.equal(parentView[0].kind, 'health');
});

test('teacher is refused for a child she has no grant for (unrelated-child access)', async () => {
  const db = new FakeDb(seedTables());
  const teacher = ctxFor('p_whitfield', db);

  await assert.rejects(
    () => school.Query.schoolReports(null, { childId: 'p_jax' }, teacher),
    (err: unknown) => err instanceof GraphQLError && err.extensions.code === 'UNAUTHORIZED',
  );
  await assert.rejects(
    () => school.Mutation.reportSchoolDay(null, { childId: 'p_jax', kind: 'health', text: 'x' }, teacher),
    (err: unknown) => err instanceof GraphQLError && err.extensions.code === 'UNAUTHORIZED',
  );
});

test('teacher cannot grant herself (or anyone) pickup access — she is not a parent and holds no such scope', async () => {
  const db = new FakeDb(seedTables());
  const teacher = ctxFor('p_whitfield', db);

  await assert.rejects(
    () =>
      access.Mutation.grantAccess(
        null,
        { actorId: 'p_whitfield', childId: 'p_nora', scopes: ['pickup.request'] },
        teacher,
      ),
    (err: unknown) => err instanceof GraphQLError && err.extensions.code === 'UNAUTHORIZED',
  );
  assert.equal(await hasScope(teacher, 'p_nora', SCOPE.pickupRequest, '2026-11-03'), false);
  assert.equal(await hasScope(teacher, 'p_nora', SCOPE.pickupVerify, '2026-11-03'), false);
});

test('teacher has no care-plan access by default', async () => {
  const db = new FakeDb(seedTables());
  const teacher = ctxFor('p_whitfield', db);
  await assert.rejects(
    () => authorizeChild(teacher, 'p_nora', SCOPE.careplan),
    (err: unknown) => err instanceof GraphQLError && err.extensions.code === 'UNAUTHORIZED',
  );
});

test('teacher\'s grant carries no address/location scope — no code path in this PR can hand her coordinates', () => {
  const grant = seedTables().grants[0];
  const scopes = grant.scopes as string[];
  assert.deepEqual([...scopes].sort(), ['school.read', 'school.report']);
  assert.equal(scopes.some((s) => /address|location|coord/i.test(s)), false);
});

test('Cast v2 fixtures wire Ms. Whitfield into the SAME source db:reset/db:seed restore from (offline half of "reset restores the teacher")', () => {
  const cast = createCastV2();
  const person = cast.people.find((p) => p.id === 'p_whitfield');
  assert.ok(person, 'p_whitfield must be in createCastV2().people');
  assert.equal(person!.display_name, 'Ms. Whitfield');

  const rel = cast.relationships.find((r) => r.id === 'r_whitfield_teacher');
  assert.ok(rel, 'teacher relationship must be in createCastV2().relationships');
  assert.equal(rel!.from_id, 'p_whitfield');
  assert.equal(rel!.to_id, 'p_nora');
  assert.equal(rel!.type, 'teacher');

  const grant = cast.grants.find((g) => g.id === 'g_whitfield_school');
  assert.ok(grant, 'school grant must be in createCastV2().grants');
  assert.deepEqual([...grant!.scopes].sort(), ['school.read', 'school.report']);
  // Live reset/reseed actually restoring these rows against the shared database is Bentley's
  // deployment check, not provable from this process.
});
