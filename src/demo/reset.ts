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
import { dropPersonaSessionCache } from './persona-sessions';

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

export type ResetReport = { restored: Record<string, number>; cleared: Record<string, number>; droppedSessionCache: true };

export async function resetDemo(actor = 'resetDemo'): Promise<ResetReport> {
  const data = fixtures();
  const c = client();
  await c.connect();
  const cleared: Record<string, number> = {};
  const restored: Record<string, number> = {};

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
      const rows = data[table] ?? [];
      if (!rows.length) continue;
      const keys = pkOf(table);
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const valueRow = (r: Row) => `(${cols.map((_, i) => `$${i + 1}`).join(',')})`;
      let n = 0;
      for (const row of rows) {
        const params = cols.map((k) => row[k] ?? null);
        const conflict = keys.join(',');
        const updatable = cols.filter((x) => !keys.includes(x));
        // No non-key columns means the row is fully identified by its key: nothing to update.
        const action = updatable.length
          ? `do update set ${updatable.map((x) => `${x} = excluded.${x}`).join(', ')}`
          : 'do nothing';
        // valueRow() already yields "(...)" — wrapping it again makes a nested row expression.
        const sql = `insert into ${table} (${cols.join(',')}) values ${valueRow(row)} on conflict (${conflict}) ${action}`;
        // Diagnostics carry SHAPE only: table, column names, counts. Never bound values.
        if (process.env.RESET_DEMO_DEBUG === '1') {
          const placeholders = (sql.match(/\$\d+/g) ?? []).length;
          console.log(`[reset] ${table} cols=${cols.length} placeholders=${placeholders} params=${params.length} names=${cols.join(',')}`);
        }
        const r = await c.query(sql, params);
        n += r.rowCount ?? 0;
      }
      restored[table] = n;
    }

    // Disposable Orbit records go through the privileged, database-authorised path (0042).
    // Deleting them here directly would hit the append-only guard, which is the point of the split.
    const orbit = await c.query('select reset_demo_orbit($1) as r', [actor]);
    const removed = orbit.rows[0]?.r ?? {};
    for (const [k, v] of Object.entries(removed)) if (Number(v) > 0) cleared[k] = Number(v);

    await c.query('commit');
  } catch (error) {
    await c.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await c.end();
  }

  // Only after a committed restore: a stale session cache would otherwise serve pre-reset reads.
  dropPersonaSessionCache();
  return { restored, cleared, droppedSessionCache: true };
}
