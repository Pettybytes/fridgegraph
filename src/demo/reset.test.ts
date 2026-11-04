import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import { resetDemo, resetSnapshot } from './reset';
import { createSimulatedCoordination } from '../fixtures-simulated';

const report = { restored: { coordination_jobs: 216 }, cleared: {}, demoDecisionsCleared: 0, createdFamiliesRemoved: 0, familyRows: [] };
test('restores the complete canonical history with one database statement, not one round trip per row', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const fake = { connect: async () => {}, end: async () => {}, query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values }); return { rowCount: 1, rows: [{ report }] };
  } } as unknown as pg.Client;
  const result = await resetDemo('p_mom', { client: () => fake, schedule: () => {} });
  assert.equal(calls.length, 1, 'reset must use one atomic database statement regardless of fixture row count');
  assert.match(calls[0].sql, /restore_demo_snapshot/);
  const data = JSON.parse(calls[0].values[2] as string);
  assert.equal(data.coordination_jobs.length, 236);
  const actualIds = new Set(data.coordination_jobs.map((r: {id: string}) => r.id));
  assert.equal(createSimulatedCoordination().coordination_jobs.filter(r => actualIds.has(r.id)).length, 216);
  assert.equal(new Set(data.coordination_jobs.map((r: {child_id: string}) => r.child_id)).size, 10);
  assert.ok(data.attempts.length > 200);
  assert.equal(result.status, 'committed');
});
test('does not await external-account cleanup after a committed restore', async () => {
  let task: (() => Promise<void>) | undefined, purged = false;
  const fake = { connect: async () => {}, end: async () => {}, query: async () => ({ rows: [{ report }] }) } as unknown as pg.Client;
  const receipt = await resetDemo('p_mom', { client: () => fake, schedule: t => { task = t; }, purge: async () => { purged = true; }, reconcile: async () => ({ reconciled: 0, markersCleared: 0, active: 0 }) });
  assert.equal(receipt.status, 'committed'); assert.equal(purged, false);
  assert.ok(task); await task(); assert.equal(purged, true);
});
test('a failed atomic statement never starts cleanup or returns a success receipt', async () => {
  let scheduled = false, ended = false;
  const fake = { connect: async () => {}, end: async () => { ended = true; }, query: async () => { throw Object.assign(new Error('INJECTED_ROLLBACK'), { code: 'P0001' }); } } as unknown as pg.Client;
  await assert.rejects(resetDemo('p_mom', { client: () => fake, schedule: () => { scheduled = true; } }), /INJECTED_ROLLBACK/);
  assert.equal(scheduled, false); assert.equal(ended, true);
});
test('snapshot status time is refreshed while stable fixture IDs are retained', () => {
  const a = resetSnapshot(), b = resetSnapshot();
  assert.deepEqual(a.fixtures.coordination_jobs.map(r => r.id), b.fixtures.coordination_jobs.map(r => r.id));
  assert.equal(Date.parse(a.fixtures.shared_statuses[0].expires_at as string) - Date.parse(a.fixtures.shared_statuses[0].set_at as string), 86400000);
});
