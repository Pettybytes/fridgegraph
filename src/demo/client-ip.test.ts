import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TRUSTED_PROXIES, isResolvedClient, resolveClientIp } from './client-ip';
import { InFlightLocks, RESET_IN_FLIGHT, windowRefusal } from './guards';

test('X-Forwarded-For is IGNORED when the socket peer is not a trusted proxy', () => {
  // A direct caller claiming to be the proxy must not be believed.
  assert.equal(resolveClientIp('203.0.113.9', '127.0.0.1', DEFAULT_TRUSTED_PROXIES), '203.0.113.9');
  assert.equal(resolveClientIp('203.0.113.9', '10.0.0.1, 127.0.0.1'), '203.0.113.9');
});

test('behind the trusted proxy no-address header leaves the peer as the client', () => {
  assert.equal(resolveClientIp('127.0.0.1', undefined), '127.0.0.1');
  assert.equal(resolveClientIp('127.0.0.1', ''), '127.0.0.1');
});

test('the real client is the RIGHT-most untrusted hop, not the left-most claimed address', () => {
  // cloudflared appends the address it saw: attacker-supplied "1.2.3.4" sits to the LEFT.
  assert.equal(resolveClientIp('127.0.0.1', '1.2.3.4, 203.0.113.7'), '203.0.113.7');
  // Multiple trusted hops are skipped; the first untrusted one from the right wins.
  assert.equal(resolveClientIp('127.0.0.1', '1.2.3.4, 203.0.113.7, 127.0.0.1', DEFAULT_TRUSTED_PROXIES), '203.0.113.7');
});

test('a spoofed loopback entry from outside cannot masquerade as a trusted hop', () => {
  const resolved = resolveClientIp('127.0.0.1', '127.0.0.1, 127.0.0.1');
  // Every hop is trusted → no client identity recoverable; the peer is returned and isResolvedClient is false.
  assert.equal(resolved, '127.0.0.1');
  assert.equal(isResolvedClient(resolved), false);
});

test('in-flight lock admits one holder and refuses the second', () => {
  const locks = new InFlightLocks();
  assert.equal(locks.tryAcquire('p_mom'), true);
  assert.equal(locks.tryAcquire('p_mom'), false, 'overlapping reset must be refused');
  assert.equal(locks.tryAcquire('p_gma'), true, 'a different identity is unaffected');
  locks.release('p_mom');
  assert.equal(locks.tryAcquire('p_mom'), true, 'released locks can be re-acquired');
  assert.deepEqual(RESET_IN_FLIGHT, { status: 409, body: { error: 'RESET_IN_FLIGHT' } });
});

test('the window limiter fires once the window is full and reports when it reopens', () => {
  const now = 1_000_000;
  assert.equal(windowRefusal(now, [], 60_000, 3, 'RESET_IP_RATE_LIMITED'), null);
  assert.equal(windowRefusal(now, [now - 10_000], 60_000, 3, 'RESET_IP_RATE_LIMITED'), null);
  const refused = windowRefusal(now, [now - 50_000, now - 40_000, now - 30_000], 60_000, 3, 'RESET_IP_RATE_LIMITED');
  assert.equal(refused?.status, 429);
  assert.deepEqual(refused?.body, { error: 'RESET_IP_RATE_LIMITED', retryAfterMs: 10_000 });
  // Old hits fall out of the window.
  assert.equal(windowRefusal(now, [now - 60_001, now - 60_002, now - 60_003], 60_000, 3, 'RESET_IP_RATE_LIMITED'), null);
});
