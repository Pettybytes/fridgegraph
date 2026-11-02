import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPgDiscoverySweeper, pgSweeperDeps, type Queryable } from './discoverySweeperPg';

type FakePool = Queryable & { end: () => Promise<void>; emitError: (e: Error) => void; queries: string[] };

function fakePool(handler: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>): FakePool {
  const queries: string[] = [];
  const listeners: Array<(e: Error) => void> = [];
  return {
    queries,
    query: async (sql: string, params?: unknown[]) => { queries.push(sql); return handler(sql, params); },
    on: (_event: string, cb: (e: Error) => void) => { listeners.push(cb); },
    end: async () => {},
    emitError: (e: Error) => { for (const cb of listeners) cb(e); },
  } as unknown as FakePool;
}

test('a failing listing does not throw out of the sweeper', async () => {
  const logs: string[] = [];
  const pool = fakePool(async () => { throw new Error('connection terminated'); });
  const started = await startPgDiscoverySweeper({ dbUrl: 'postgres://x', poolFactory: () => pool, log: (m) => logs.push(m) });
  assert.equal(started.started, true, 'the server must not be blocked by a dead database');
  const result = await started.tick?.();
  assert.deepEqual(result, { closed: 0, failed: 1 });
  assert.match(logs.join('\n'), /list failed/);
  started.stop();
});

test('an idle-client error event is handled, and the next tick recovers', async () => {
  let failNext = true;
  const logs: string[] = [];
  const pool = fakePool(async (sql) => {
    if (sql.includes('coordination_jobs') && failNext) { failNext = false; throw new Error('Connection terminated unexpectedly'); }
    if (sql.includes('coordination_jobs')) return { rows: [{ id: 'job_recovered' }] };
    return { rows: [] };
  });

  const started = await startPgDiscoverySweeper({ dbUrl: 'postgres://x', poolFactory: () => pool, log: (m) => logs.push(m) });

  // The pool emits an error on an idle drop. With no listener in the old code this killed the process.
  assert.doesNotThrow(() => pool.emitError(new Error('idle client dropped')));
  assert.match(logs.join('\n'), /idle client error/);

  const next = await started.tick?.();
  assert.deepEqual(next, { closed: 1, failed: 0 }, 'the next tick must work after the drop');
  assert.match(pool.queries.join('\n'), /close_discovery/);
  started.stop();
});

test('an unreachable database at boot only logs — startup does not throw and stays started', async () => {
  const logs: string[] = [];
  const pool = fakePool(async () => { throw new Error('ECONNREFUSED 127.0.0.1:5432'); });

  const started = await startPgDiscoverySweeper({ dbUrl: 'postgres://unreachable', poolFactory: () => pool, log: (m) => logs.push(m) });
  assert.equal(started.started, true);
  assert.match(logs.join('\n'), /list failed|ECONNREFUSED/);
  started.stop();
});

test('a pool that cannot even be created is reported, not thrown', async () => {
  const started = await startPgDiscoverySweeper({
    dbUrl: 'postgres://x',
    poolFactory: () => { throw new Error('invalid connection string'); },
    log: () => {},
  });
  assert.equal(started.started, false);
  started.stop();
});

test('no database URL means no sweeper and no crash', async () => {
  const started = await startPgDiscoverySweeper({ dbUrl: '', log: () => {} });
  assert.equal(started.started, false);
});

test('DISCOVERY_SWEEPER=off wins over a URL', async () => {
  const prev = process.env.DISCOVERY_SWEEPER;
  process.env.DISCOVERY_SWEEPER = 'off';
  try {
    const started = await startPgDiscoverySweeper({ dbUrl: 'postgres://x', log: () => {} });
    assert.equal(started.started, false);
  } finally {
    if (prev === undefined) delete process.env.DISCOVERY_SWEEPER; else process.env.DISCOVERY_SWEEPER = prev;
  }
});

test('deps: close reports its failure to the sweeper instead of swallowing it', async () => {
  const ok = pgSweeperDeps(fakePool(async () => ({ rows: [] })), () => {});
  await ok.close('job_ok');

  const bad = pgSweeperDeps(fakePool(async () => { throw new Error('deadlock detected'); }), () => {});
  await assert.rejects(() => bad.close('job_bad'), /close_discovery\(job_bad\) failed — deadlock detected/);
});
