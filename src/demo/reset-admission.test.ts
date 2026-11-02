/**
 * Reset admission, as the route actually sequences it.
 *
 * This mirrors `POST /api/demo/reset` step for step — client IP → per-IP window → per-person cooldown →
 * SHARED lock → work → release — because the lock only proves anything if it is held across the await.
 * A per-identity lock looked correct in isolation and was wrong in principle: `resetDemo` rewrites
 * people/households/grants/relationships/shared_statuses, which are shared rows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cooldownRefusal, identityRefusal, InFlightLocks, SHARED_RESET_LOCK, windowRefusal } from './guards';
import { resolveClientIp } from './client-ip';

type Admission = { status: number; body?: Record<string, unknown> };

const IP_WINDOW_MS = 60_000;
const IP_MAX = 5;
const COOLDOWN_MS = 30_000;

/** One shared lock and one shared hit table, as the running server has. */
function makeServer() {
  const locks = new InFlightLocks();
  const lastResetAt = new Map<string, number>();
  const ipHits = new Map<string, number[]>();
  let executions = 0;

  async function handle(opts: {
    socket: string;
    xff?: string;
    identity: { ok: boolean; demo?: boolean; demoGuide?: boolean; personId?: string };
    now: number;
    work: () => Promise<void>;
  }): Promise<Admission> {
    const clientIp = resolveClientIp(opts.socket, opts.xff);
    const hits = (ipHits.get(clientIp) ?? []).filter((t) => opts.now - t < IP_WINDOW_MS);
    const ipRefusal = windowRefusal(opts.now, hits, IP_WINDOW_MS, IP_MAX, 'RESET_IP_RATE_LIMITED');
    if (ipRefusal) return ipRefusal;

    const refusal = identityRefusal(opts.identity);
    if (refusal) return refusal;
    if (!opts.identity.ok) return { status: 401, body: { error: 'UNAUTHENTICATED' } };

    const last = lastResetAt.get(opts.identity.personId ?? '') ?? 0;
    const throttled = cooldownRefusal(opts.now, last, COOLDOWN_MS, 'RESET_RATE_LIMITED');
    if (throttled) return throttled;

    if (!locks.tryAcquire(SHARED_RESET_LOCK)) return { status: 409, body: { error: 'RESET_IN_FLIGHT' } };
    lastResetAt.set(opts.identity.personId ?? '', opts.now);
    hits.push(opts.now);
    ipHits.set(clientIp, hits);
    try {
      executions += 1;
      await opts.work();
      return { status: 200 };
    } finally {
      locks.release(SHARED_RESET_LOCK);
    }
  }

  return { handle, executions: () => executions, locks };
}

const kendra = { ok: true, demo: true, demoGuide: false, personId: 'p_mom' };
const dana = { ok: true, demo: true, demoGuide: false, personId: 'p_dana' };

test('overlapping resets from DIFFERENT identities: one runs, the other gets 409', async () => {
  const srv = makeServer();
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((r) => { releaseFirst = r; });
  const first = srv.handle({ socket: '127.0.0.1', xff: '203.0.113.5', identity: kendra, now: 1_000_000,
    work: () => firstGate });
  // Second request arrives while the first is still inside resetDemo.
  const second = await srv.handle({ socket: '127.0.0.1', xff: '203.0.113.6', identity: dana, now: 1_000_001,
    work: async () => {} });
  assert.equal(second.status, 409);
  assert.deepEqual(second.body, { error: 'RESET_IN_FLIGHT' });
  releaseFirst();
  assert.equal((await first).status, 200);
  assert.equal(srv.executions(), 1, 'exactly one resetDemo may run at a time');
});

test('a failure inside the work releases the shared lock', async () => {
  const srv = makeServer();
  await assert.rejects(srv.handle({ socket: '127.0.0.1', xff: '203.0.113.5', identity: kendra, now: 2_000_000,
    work: async () => { throw new Error('db down'); } }));
  assert.equal(srv.locks.has(SHARED_RESET_LOCK), false);
  const retry = await srv.handle({ socket: '127.0.0.1', xff: '203.0.113.5', identity: dana, now: 2_000_001,
    work: async () => {} });
  assert.equal(retry.status, 200, 'the lock must not stay held after a failure');
});

test('sequential calls from one identity still obey the per-person cooldown', async () => {
  const srv = makeServer();
  assert.equal((await srv.handle({ socket: '127.0.0.1', identity: kendra, now: 3_000_000, work: async () => {} })).status, 200);
  const second = await srv.handle({ socket: '127.0.0.1', identity: kendra, now: 3_010_000, work: async () => {} });
  assert.equal(second.status, 429);
  assert.equal(second.body?.error, 'RESET_RATE_LIMITED');
});

test('the per-IP window still bites even when identities differ', async () => {
  const srv = makeServer();
  for (let i = 0; i < IP_MAX; i += 1) {
    const id = { ok: true, demo: true, demoGuide: false, personId: `p_${i}` };
    assert.equal((await srv.handle({ socket: '127.0.0.1', xff: '198.51.100.9', identity: id, now: 4_000_000 + i, work: async () => {} })).status, 200);
  }
  const blocked = await srv.handle({ socket: '127.0.0.1', xff: '198.51.100.9', identity: { ok: true, demo: true, demoGuide: false, personId: 'p_new' }, now: 4_000_010, work: async () => {} });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body?.error, 'RESET_IP_RATE_LIMITED');
});
