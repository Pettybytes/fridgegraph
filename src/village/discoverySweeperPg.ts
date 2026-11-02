/**
 * Postgres wiring for the discovery sweeper — crash-isolated.
 *
 * THE DEFECT (review of #107)
 * The first version created a single `pg.Client`, never attached an `error` listener, and awaited
 * `connect()` at the top level of `main.ts`. Two consequences, both fatal to the demo API (4008):
 *   1. an idle connection drop emits `error` on an EventEmitter with no listener → uncaught exception
 *      → the whole process exits;
 *   2. if the database is unreachable at boot, the rejected `connect()` escapes `main.ts` and 4008
 *      never comes up — the demo API and login go down with the sweeper.
 *
 * DESIGN
 *  - a `Pool`, so a dead connection is replaced instead of typing every later query into an error;
 *  - an `error` listener on the pool AND on idle clients, logging only — never throwing;
 *  - `listExpired`/`close` never throw: they degrade, and the sweeper records the failure;
 *  - `startPgDiscoverySweeper` never throws: no URL, a broken pool, or a failing first query is a
 *    log line, and the rest of the server keeps serving.
 */

import pg from 'pg';
import { createDiscoverySweeper, type SweeperDeps, type SweepResult } from './discoverySweeper';

export type Queryable = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type LogFn = (message: string) => void;

/** Sweeper deps over anything queryable. Every failure is returned, never thrown. */
export function pgSweeperDeps(pool: Queryable, log: LogFn): SweeperDeps {
  return {
    async listExpired(limit: number): Promise<string[]> {
      // No catch here on purpose: the sweeper wraps this call, counts the failure and keeps running.
      // Swallowing it would report a dead database as "nothing to do".
      {
        const res = await pool.query(
          `select id from coordination_jobs
            where status = 'discovering'
              and now() >= created_at + make_interval(secs => discovery_timeout_seconds)
            order by created_at
            limit $1`,
          [limit],
        );
        return res.rows.map((r) => String(r.id));
      }
    },
    async close(jobId: string): Promise<void> {
      try {
        await pool.query('select close_discovery($1)', [jobId]);
      } catch (e) {
        // Reported to the sweeper, which counts it and keeps going.
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
  /** Injected in tests; production uses a real pg.Pool. */
  poolFactory?: (url: string, log: LogFn) => Queryable & { end?: () => Promise<void> };
};

export type Started = {
  started: boolean;
  stop: () => void;
  tick?: () => Promise<SweepResult>;
};

function defaultPoolFactory(url: string, log: LogFn): Queryable & { end: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString: url, application_name: 'fg-discovery-sweeper', max: 2 });
  // An idle client dropping its connection is NORMAL for a long-lived process. Without this listener
  // Node treats it as an uncaught exception and the whole server dies.
  pool.on('error', (e: Error) => log(`sweeper: idle client error — ${e.message}`));
  return pool;
}

/**
 * Start the sweeper. NEVER throws: a missing URL, an unreachable database or a broken pool is logged
 * and `started:false` (or a running loop whose ticks fail politely) — 4008 keeps serving either way.
 */
export async function startPgDiscoverySweeper(options: StartOptions = {}): Promise<Started> {
  const log = options.log ?? ((m: string) => console.log(`[sweeper] ${m}`));
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

  // Attach the idle-drop listener regardless of how the pool was built: an injected pool must be as
  // safe as the default one, and a test that injects a pool is exactly where this regressed.
  const onFn = (pool as unknown as { on?: (event: string, cb: (e: Error) => void) => void }).on;
  if (typeof onFn === 'function') onFn('error', (e: Error) => log(`sweeper: idle client error — ${e.message}`));

  const deps = pgSweeperDeps(pool, log);
  const sweeper = createDiscoverySweeper(deps, {
    intervalMs: options.intervalMs,
    batchLimit: options.batchLimit,
  });

  // Probe once, but never let a down database reach the caller.
  try {
    await sweeper.tick();
  } catch (e) {
    log(`first tick failed — ${e instanceof Error ? e.message : String(e)}`);
  }

  sweeper.start();
  log('started (pool, error-isolated)');

  return {
    started: true,
    stop: () => {
      sweeper.stop();
      void pool?.end?.().catch(() => undefined);
    },
    tick: sweeper.tick,
  };
}
