/**
 * Discovery-timeout sweeper — the missing owner of the 60 s window.
 *
 * THE DEFECT (measured 2026-11-02)
 * `close_discovery(job)` calls `_rank_and_advance`, but nothing in production ever calls it: the only
 * callers were two old ops scripts. A job whose window elapsed therefore stayed `discovering`
 * forever, and `_rank_and_advance`'s own early return (`pending > 0 AND now() < created + timeout`)
 * never lifted because the caller it needed never came. Ranking at reply time is correct; the
 * TIMEOUT half of discovery had no owner.
 *
 * DESIGN RULES
 *  - RESTART-SAFE: no in-memory queue and no timestamps carried across restarts. Every tick asks the
 *    database which jobs are expired right now; a restart simply resumes asking.
 *  - BOUNDED: at most `batchLimit` jobs per tick, so a backlog cannot turn into one long
 *    transaction or a thundering herd.
 *  - IDEMPOTENT: `close_discovery` is a no-op on a job that is no longer `discovering`, so a tick
 *    that overlaps another (or a reply that advanced the job first) changes nothing.
 *  - NON-OVERLAPPING: a tick in progress skips the next one rather than stacking.
 *  - ONE FAILURE DOES NOT STOP THE BATCH: a job that errors is logged and the rest still run.
 */

export type SweeperDeps = {
  /** Jobs whose discovery window has elapsed, oldest first, at most `limit`. */
  listExpired(limit: number): Promise<string[]>;
  /** Close one job's discovery window. Must be safe to call twice. */
  close(jobId: string): Promise<void>;
  log?(message: string): void;
};

export type SweeperOptions = {
  intervalMs?: number;
  batchLimit?: number;
};

export type SweepResult = { closed: number; failed: number };

export function createDiscoverySweeper(deps: SweeperDeps, options: SweeperOptions = {}) {
  const intervalMs = options.intervalMs ?? 15_000;
  const batchLimit = options.batchLimit ?? 25;

  let inFlight = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<SweepResult> {
    if (inFlight) return { closed: 0, failed: 0 };
    inFlight = true;
    let closed = 0;
    let failed = 0;
    try {
      const ids = await deps.listExpired(batchLimit);
      for (const id of ids) {
        try {
          await deps.close(id);
          closed += 1;
        } catch (e) {
          failed += 1;
          deps.log?.(`sweeper: close ${id} failed — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      failed += 1;
      deps.log?.(`sweeper: list failed — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      inFlight = false;
    }
    return { closed, failed };
  }

  function start(): void {
    if (timer || stopped) return;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
    // Never hold the process open on the sweeper alone.
    if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref();
  }

  function stop(): void {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { tick, start, stop };
}
