/**
 * resetDemo — restore the DEMO state only.
 *
 * Deliberately NOT `db:reset`: that is the operator path and touches baseline tables wholesale.
 * This restores exactly the additive fixture set plus the Cast v2 seed, inside ONE transaction under
 * an advisory lock, so a failure can never leave a partially restored demo. Non-sandbox rows and
 * audit history are never touched: every delete is scoped to `sandbox = true` or to fixture ids.
 */
import pg from 'pg';
import { createSimulatedCoordination } from '../fixtures-simulated';
import { createSimulatedCalendar } from '../fixtures-simulated';
import { createSimulatedOrbit } from '../fixtures-simulated';
import { createSimulatedCheckIn } from '../fixtures-simulated';
import { createSimulatedCareFacts } from '../fixtures-simulated';
import { createSimulatedPrivate } from '../fixtures-simulated';
import { createCastV2 } from '../fixtures-cast-v2';
import { dropPersonaSessionCache } from './persona-sessions';
import { deleteCreatedFamilies, purgeFamilyArtifacts, reconcileAbandonedFamilies, type FamilyRow } from './family';

const LOCK_KEY = 918_273_645; // arbitrary but stable: one reset at a time, cluster-wide

function client() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('SUPABASE_DB_URL is not set');
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
}

type Row = Record<string, unknown>;

/** Tables that carry a `sandbox` column: delete every sandbox row, leave everything else. */
const SANDBOX_TABLES = [
  // Only tables that actually carry a `sandbox` column in `public`. `approvals` is audit history and
  // is never deleted here; `events` has no sandbox column and is restored by fixture upsert instead.
  'coordination_jobs', 'attempts', 'holidays', 'routines', 'adult_availability',
  'holiday_arrangements', 'expected_checkins', 'care_facts',
] as const;

/** Tables whose fixture rows are identified by their own primary key, not by a sandbox flag. */
const ID_TABLES = ['households', 'people', 'children', 'household_members', 'household_policies', 'grants', 'relationships'] as const;

function pkOf(table: string): string[] {
  if (table === 'care_facts') return ['child_id', 'key'];
  if (table === 'household_policies') return ['household_id', 'rule'];
  if (table === 'household_members') return ['person_id', 'household_id'];
  if (table === 'children') return ['person_id'];
  if (table === 'grants') return ['id'];
  if (table === 'relationships') return ['id'];
  return ['id'];
}

function fixtures(): Record<string, Row[]> {
  const sim = createSimulatedCoordination();
  const cal = createSimulatedCalendar();
  const priv = createSimulatedPrivate();
  const orbit = createSimulatedOrbit();
  const checkin = createSimulatedCheckIn();
  const facts = createSimulatedCareFacts();
  return {
    coordination_jobs: sim.coordination_jobs as unknown as Row[],
    attempts: sim.attempts as unknown as Row[],
    holidays: cal.holidays, routines: cal.routines, adult_availability: cal.adult_availability,
    holiday_arrangements: cal.holiday_arrangements, events: cal.events,
    households: priv.households, people: priv.people, children: priv.children,
    household_members: priv.household_members,
    household_policies: orbit.household_policies,
    expected_checkins: checkin.expected_checkins,
    care_facts: facts.care_facts,
  };
}

/**
 * Rows reset must restore from the CANONICAL seed source, per table.
 *
 * `fixtures()` above is only the simulated/private set. Cast v2 is demo CONTENT, not test junk, and
 * several of its tables are sandbox-marked, so step 1 clears them and this set puts them back: the
 * Malik care facts, the 32 Cast routines, its people/households/children/memberships and its events.
 * Deletion stays exactly as scoped before (the `data` id lists above); these rows are upserted only,
 * so no FK-bearing Cast row is ever deleted and re-inserted.
 */
function castRowsByTable(): Record<string, Row[]> {
  const cv = createCastV2() as unknown as Record<string, Row[]>;
  const out: Record<string, Row[]> = {};
  for (const [table, rows] of Object.entries(cv)) if (Array.isArray(rows)) out[table] = rows;
  return out;
}

/** Idempotent upsert of one table's rows. Column set is taken from the rows themselves. */
async function upsertRows(c: pg.Client, table: string, rows: Row[]): Promise<number> {
  if (!rows.length) return 0;
  const keys = pkOf(table);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const conflict = keys.join(',');
  const updatable = cols.filter((x) => !keys.includes(x));
  const action = updatable.length
    ? `do update set ${updatable.map((x) => `${x} = excluded.${x}`).join(', ')}`
    : 'do nothing';
  let n = 0;
  for (const row of rows) {
    const params = cols.map((k) => row[k] ?? null);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    const sql = `insert into ${table} (${cols.join(',')}) values (${placeholders}) on conflict (${conflict}) ${action}`;
    if (process.env.RESET_DEMO_DEBUG === '1') {
      console.log(`[reset] ${table} cols=${cols.length} placeholders=${cols.length} params=${params.length} names=${cols.join(',')}`);
    }
    const r = await c.query(sql, params);
    n += r.rowCount ?? 0;
  }
  return n;
}

export type ResetReport = {
  restored: Record<string, number>;
  cleared: Record<string, number>;
  /** Demo decisions cleared (0050). Real decisions are never counted here, because none are cleared. */
  demoDecisionsCleared: number;
  /** Created (sandbox) families removed; they are not fixture rows. */
  createdFamiliesRemoved: number;
  /** Abandoned family accounts reconciled (0051): deleted with their rows and markers. */
  abandonedFamiliesReconciled: number;
  droppedSessionCache: true;
};

export async function resetDemo(actor = 'resetDemo'): Promise<ResetReport> {
  const data = fixtures();
  const c = client();
  await c.connect();
  const cleared: Record<string, number> = {};
  const restored: Record<string, number> = {};
  let demoDecisionsCleared = 0;
  let familyRows: FamilyRow[] = [];

  try {
    await c.query('begin');
    // Serialize against every other reset AND against demo writes that take the same lock.
    await c.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]);

    // 1. Clear only demo rows.
    for (const table of SANDBOX_TABLES) {
      const has = await c.query(
        `select 1 from information_schema.columns
          where table_schema = 'public' and table_name = $1 and column_name = 'sandbox'`, [table]);
      if (has.rowCount) {
        const r = await c.query(`delete from ${table} where sandbox is true`);
        if (r.rowCount) cleared[table] = r.rowCount;
      }
    }
    for (const table of ID_TABLES) {
      const rows = data[table] ?? [];
      if (!rows.length) continue;
      const keys = pkOf(table);
      let n = 0;
      for (const row of rows) {
        const where = keys.map((k, i) => `${k} = $${i + 1}`).join(' and ');
        const r = await c.query(`delete from ${table} where ${where}`, keys.map((k) => row[k]));
        n += r.rowCount ?? 0;
      }
      if (n) cleared[table] = n;
    }

    // 2. Restore the fixture set (upsert keeps this idempotent) in FK-safe order: people and
    // households before children, children before everything that references them, events LAST
    // (the fixture's audit event references the audit child).
    const RESTORE_ORDER = [
      'people', 'households', 'children', 'household_members', 'holidays', 'routines',
      'adult_availability', 'holiday_arrangements', 'coordination_jobs', 'attempts',
      'expected_checkins', 'care_facts', 'household_policies', 'events',
    ];
    for (const table of RESTORE_ORDER) {
      const n = await upsertRows(c, table, data[table] ?? []);
      if (n) restored[table] = n;
    }

    // 3. Cast v2 from the SAME canonical source `db:seed` merges. Step 1 cleared every sandbox row,
    // which includes Cast rows in sandbox-marked tables (care_facts, routines); without this pass the
    // demo loses content on every reset — the judges' button would break the Priya/Dwayne scenes.
    // Upsert only: no Cast row is deleted here, so no FK is ever broken mid-reset.
    const cast = castRowsByTable();
    for (const table of RESTORE_ORDER) {
      const rows = cast[table] ?? [];
      if (!rows.length) continue;
      const n = await upsertRows(c, table, rows);
      if (n) restored[table] = (restored[table] ?? 0) + n;
    }

    // Geographic seed (0062): coordinates + canonical event→place links, restored through the
    // authorized place-reset helper the database already owns. Runs AFTER events are restored, because
    // it re-applies links to rows that must already exist — and it removes only non-fixture sandbox
    // places, so no household's fixture rows are deleted wholesale.
    const places = await c.query('select reset_demo_places($1) as r', [actor]);
    const placeCounts = (places.rows[0]?.r ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(placeCounts)) {
      if (Number(v) > 0) restored[k] = Number(v);
    }

    // Disposable Orbit records go through the privileged, database-authorised path (0042).
    // Deleting them here directly would hit the append-only guard, which is the point of the split.
    // Created families are not fixture rows, so the id-scoped loops above never touch them. Their
    // data goes in the SAME transaction; the identity mapping and auth users are purged after commit
    // (a mapping that never lands is safer than a mapping to deleted rows).
    familyRows = await deleteCreatedFamilies(c);

    // Demo decisions are reset; real decisions are never touched (0050). Both counts ride in the
    // SINGLE audit row this reset writes, as numbers with no ids or names.
    const decisions = await c.query('select reset_demo_decisions() as n');
    demoDecisionsCleared = Number(decisions.rows[0]?.n ?? 0);

    // School-report leftovers (0073). Scoped to proposals authored by a demo identity, plus the
    // reports those proposals confirmed. A direct `reportSchoolDay` filing has no provenance column,
    // so it is deliberately NOT covered here rather than guessed at by time or id prefix.
    const school = await c.query('select reset_demo_school_reports() as r');
    const schoolCounts = (school.rows[0]?.r ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(schoolCounts)) if (Number(v) > 0) cleared[k] = Number(v);

    const orbit = await c.query('select reset_demo_orbit($1, $2::jsonb) as r', [
      actor,
      JSON.stringify({
        approvals: demoDecisionsCleared,
        createdFamiliesRemoved: familyRows.length,
      }),
    ]);
    const removed = orbit.rows[0]?.r ?? {};
    for (const [k, v] of Object.entries(removed)) if (Number(v) > 0) cleared[k] = Number(v);

    await c.query('commit');
  } catch (error) {
    await c.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await c.end();
  }

  // After the commit: a created family's persona must stop resolving, so the identity mapping is
  // removed before anything can mint or verify it again.
  await purgeFamilyArtifacts(familyRows);

  // Then reconcile anything the registry could not name: an aborted run left a `pending` marker and,
  // possibly, an auth account with no mapping at all. This is the sweep that closes that leak.
  const reconciled = await reconcileAbandonedFamilies();

  // Only after a committed restore: a stale session cache would otherwise serve pre-reset reads.
  dropPersonaSessionCache();
  return {
    restored,
    cleared,
    demoDecisionsCleared,
    createdFamiliesRemoved: familyRows.length,
    abandonedFamiliesReconciled: reconciled.reconciled + reconciled.markersCleared,
    droppedSessionCache: true,
  };
}
