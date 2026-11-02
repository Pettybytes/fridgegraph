import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cooldownRefusal, identityRefusal, isLoopback, NO_STORE } from './guards';

test('loopback: the three forms the demo login actually sees are admitted', () => {
  for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopback(addr), true, addr);
  }
});

test('loopback: anything else is refused, including other v6-mapped addresses', () => {
  for (const addr of ['10.0.0.1', '192.168.1.20', '::ffff:10.0.0.1', '', 'localhost']) {
    assert.equal(isLoopback(addr), false, addr);
  }
});

test('identity: refusals come in a fixed order', () => {
  assert.deepEqual(identityRefusal({ ok: false }), { status: 401, body: { error: 'UNAUTHENTICATED' } });
  assert.deepEqual(identityRefusal({ ok: true, demo: false }), {
    status: 403,
    body: { error: 'DEMO_SESSION_REQUIRED' },
  });
});

test('identity: the demo guide is refused even though it IS a demo session', () => {
  const refusal = identityRefusal({ ok: true, demo: true, demoGuide: true, personId: 'p_guide' });
  assert.deepEqual(refusal, { status: 403, body: { error: 'DEMO_GUIDE_READ_ONLY' } });
});

test('identity: a writable demo session passes', () => {
  assert.equal(identityRefusal({ ok: true, demo: true, demoGuide: false, personId: 'p_mom' }), null);
});

test('cooldown: a first call is allowed, a second inside the window is not', () => {
  const cooldown = 30_000;
  assert.equal(cooldownRefusal(1_000_000, 0, cooldown, 'RESET_RATE_LIMITED'), null);
  const refused = cooldownRefusal(1_010_000, 1_000_000, cooldown, 'RESET_RATE_LIMITED');
  assert.equal(refused?.status, 429);
  assert.deepEqual(refused?.body, { error: 'RESET_RATE_LIMITED', retryAfterMs: 20_000 });
});

test('cooldown: the boundary is inclusive-safe (exactly elapsed is allowed)', () => {
  assert.equal(cooldownRefusal(1_030_000, 1_000_000, 30_000, 'RESET_RATE_LIMITED'), null);
  assert.equal(cooldownRefusal(1_029_999, 1_000_000, 30_000, 'RESET_RATE_LIMITED')?.status, 429);
});

test('reset responses are never cacheable', () => {
  assert.equal(NO_STORE, 'no-store');
});
