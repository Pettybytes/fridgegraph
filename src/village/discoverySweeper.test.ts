import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoverySweeper, type SweeperDeps } from './discoverySweeper';

function deps(overrides: Partial<SweeperDeps> & { ids?: string[] } = {}): SweeperDeps & { closedIds: string[] } {
  const closedIds: string[] = [];
  return {
    closedIds,
    listExpired: async (limit: number) => (overrides.ids ?? ['job_a', 'job_b']).slice(0, limit),
    close: async (id: string) => { closedIds.push(id); },
    ...overrides,
  };
}

test('a tick closes every expired job it was given, bounded by the batch limit', async () => {
  const d = deps({ ids: ['job_1', 'job_2', 'job_3'] });
  const sweeper = createDiscoverySweeper(d, { batchLimit: 2 });
  const result = await sweeper.tick();
  assert.deepEqual(result, { closed: 2, failed: 0 });
  assert.deepEqual(d.closedIds, ['job_1', 'job_2']);
});

test('a tick that overlaps a running tick does nothing (no stacking, no double close)', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const closedIds: string[] = [];
  const sweeper = createDiscoverySweeper({
    listExpired: async () => ['job_slow'],
    close: async (id: string) => { await gate; closedIds.push(id); },
  });

  const first = sweeper.tick();
  const second = await sweeper.tick();
  assert.deepEqual(second, { closed: 0, failed: 0 }, 'the overlapping tick must not run');

  release();
  assert.deepEqual(await first, { closed: 1, failed: 0 });
  assert.deepEqual(closedIds, ['job_slow'], 'the job is closed exactly once');
});

test('one failing job does not stop the rest of the batch', async () => {
  const logged: string[] = [];
  const closedIds: string[] = [];
  const sweeper = createDiscoverySweeper({
    listExpired: async () => ['job_ok1', 'job_bad', 'job_ok2'],
    close: async (id: string) => {
      if (id === 'job_bad') throw new Error('deadlock detected');
      closedIds.push(id);
    },
    log: (m: string) => logged.push(m),
  });

  const result = await sweeper.tick();
  assert.deepEqual(result, { closed: 2, failed: 1 });
  assert.deepEqual(closedIds, ['job_ok1', 'job_ok2']);
  assert.match(logged.join('\n'), /job_bad.*deadlock detected/);
});

test('a failing listing is reported and does not throw out of the tick', async () => {
  const sweeper = createDiscoverySweeper({
    listExpired: async () => { throw new Error('DB_UNAVAILABLE'); },
    close: async () => {},
    log: () => {},
  });
  assert.deepEqual(await sweeper.tick(), { closed: 0, failed: 1 });
});

test('a second tick after everything is closed closes nothing (restart-safe: state is the database)', async () => {
  let remaining = ['job_a'];
  const sweeper = createDiscoverySweeper({
    listExpired: async () => remaining.slice(),
    close: async (id: string) => { remaining = remaining.filter((x) => x !== id); },
  });
  assert.deepEqual(await sweeper.tick(), { closed: 1, failed: 0 });
  assert.deepEqual(await sweeper.tick(), { closed: 0, failed: 0 });
});
