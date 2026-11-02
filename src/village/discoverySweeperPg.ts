/**
 * Postgres wiring for the discovery sweeper — crash-isolated against a REAL pool.
 *
 * WHAT WENT WRONG TWICE
 *   1. The first version used a bare `pg.Client` with no `error` listener and awaited `connect()` at
 *      the top of `main.ts`: an idle drop killed the process, and an unreachable database stopped
 *      4008 from ever starting.
 *   2. The second version added a listener by detaching the method — `const onFn = pool.on; onFn(...)`
 *      — which calls `EventEmitter.on` with `this === undefined` and THROWS
 *      `TypeError: Cannot read properties of undefined (reading '_events')` on every real pg.Pool.
 *      Fake pools in the tests did not care about `this`, so the suite passed while production would
 *      have crashed on boot.
 *
 * RULES NOW
 *  - the listener is attached as a METHOD call (`pool.on?.(...)`), so `this` is the pool;
 *  - the entire start body is inside one try/catch: this function never rejects;
 *  - the pool carries `connectionTimeoutMillis` and `query_timeout`, so a hung database cannot hold
 *    the sweeper's in-flight flag forever;
 *  - a real `pg.Pool` pointed at a dead port is covered by a regression test, not a synthetic emit.
 */

import pg from 'pg';
import { createDiscoverySweeper, type SweeperDeps, type SweepResult } from './discoverySweeper';

export type Queryable = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  on?(event: string, listener: (e: Error) => void): unknown;
  listenerCount?(event: string): number;
};

export type LogFn = (message: string) => void;

export const PG_CONNECTION_TIMEOUT_MS = 5_000;
export const PG_QUERY_TIMEOUT_MS = 10_000;

/** Sweeper deps over anything queryable. A failing list is thrown so the sweeper counts it. */
export function pgSweeperDeps(pool: Queryable, log: LogFn): SweeperDeps {
  return {
    async listExpired(limit: number): Promise<string[]> {
      // No catch on purpose: swallowing a dead database here would report "nothing to do".
      const res = await pool.query(
        `select id from coordination_jobs
          where status = 'discovering'
            and now() >= created_at + make_interval(secs => discovery_timeout_seconds)
          order by created_at
          limit $1`,
        [limit],
      );
      return res.rows.map((r) => String(r.id));
    },
    async close(jobId: string): Promise<void> {
      try {
        await pool.query('select close_discovery($1)', [jobId]);
      } catch (e) {
        throw new Error(`close_discovery(${jobId}) failed — ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    log,
  };
}

export type StartOptions = {
  dbUrl?: string;
  log?: LogFn;
  intervalMs?: number;
  batchLimit?: number;
  /** Injected in tests; production uses a real pg.Pool with the timeouts above. */
  poolFactory?: (url: string, log: LogFn) => Queryable & { end?: () => Promise<void> };
};

export type Started = {
  started: boolean;
  stop: () => void;
  tick?: () => Promise<SweepResult>;
  /** Exposed so a regression test can assert the listener and the timeouts on a REAL pool. */
  pool?: Queryable & { end?: () => Promise<void> };
};

function defaultPoolFactory(url: string, log: LogFn): Queryable & { end: () => Promise<void> } {
  const pool = new pg.Pool({
    connectionString: url,
    application_name: 'fg-discovery-sweeper',
    max: 2,
    connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
    query_timeout: PG_QUERY_TIMEOUT_MS,
  });
  // Attached here AND again below (method call) so a pool built by any factory is protected.
  pool.on('error', (e: Error) => log(`sweeper: idle client error — ${e.message}`));
  return pool;
}

async function startInner(options: StartOptions, log: LogFn): Promise<Started> {
  const dbUrl = options.dbUrl ?? process.env.SUPABASE_DB_URL;

  if (process.env.DISCOVERY_SWEEPER === 'off') {
    log('disabled by DISCOVERY_SWEEPER=off');
    return { started: false, stop: () => {} };
  }
  if (!dbUrl) {
    log('NOT started — SUPABASE_DB_URL missing');
    return { started: false, stop: () => {} };
  }

  let pool: (Queryable & { end?: () => Promise<void> }) | null = null;
  try {
    pool = (options.poolFactory ?? defaultPoolFactory)(dbUrl, log);
  } catch (e) {
    log(`NOT started — pool creation failed: ${e instanceof Error ? e.message : String(e)}`);
    return { started: false, stop: () => {} };
  }

  // METHOD CALL on purpose. `const onFn = pool.on; onFn(...)` loses `this` and throws on a real pool.
  try {
    pool.on?.('error', (e: Error) => log(`sweeper: idle client error — ${e.message}`));
  } catch (e) {
    log(`listener attach failed — ${e instanceof Error ? e.message : String(e)}`);
  }

  const deps = pgSweeperDeps(pool, log);
  const sweeper = createDiscoverySweeper(deps, {
    intervalMs: options.intervalMs,
    batchLimit: options.batchLimit,
  });

  // Probe once, but a down database must not reach the caller or block startup.
  try {
    await sweeper.tick();
  } catch (e) {
    log(`first tick failed — ${e instanceof Error ? e.message : String(e)}`);
  }

  sweeper.start();
  log('started (pool, error-isolated)');

  return {
    started: true,
    pool,
    stop: () => {
      sweeper.stop();
      void pool?.end?.().catch(() => undefined);
    },
    tick: sweeper.tick,
  };
}

/**
 * Start the sweeper. NEVER throws or rejects, whatever the database does: the caller is `main.ts`,
 * and 4008 must keep serving with a broken database.
 */
export async function startPgDiscoverySweeper(options: StartOptions = {}): Promise<Started> {
  const log = options.log ?? ((m: string) => console.log(`[sweeper] ${m}`));
  try {
    return await startInner(options, log);
  } catch (e) {
    log(`NOT started — unexpected startup error: ${e instanceof Error ? e.message : String(e)}`);
    return { started: false, stop: () => {} };
  }
}
