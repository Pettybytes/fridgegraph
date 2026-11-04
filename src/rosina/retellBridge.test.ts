import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { RetellBridge, signPayload, type TurnRunner } from './retellBridge';

const SECRET = 'test-only-bridge-secret';
function signed(body: unknown, ts = Date.now()) {
  const raw = JSON.stringify(body);
  return { raw, headers: { 'x-bridge-timestamp': String(ts), 'x-bridge-signature': signPayload(SECRET, ts, raw) } };
}
const proposalRunner: TurnRunner = async (req) => {
  if (!req.session.childIds.includes(req.session.childId)) {
    return { reply: 'I can only help with children shared with you.', actions: [] };
  }
  if (/cancel/i.test(req.message)) return { reply: 'Okay, cancelled. Nothing was changed.', actions: [] };
  return { reply: 'Review this change, then confirm. Nothing has been saved.', actions: [{ id: 'calendar-change', args: { operation: 'create', childId: req.session.childId } }] };
};
function bridge(runner: TurnRunner = proposalRunner) {
  return new RetellBridge({ secret: SECRET, runTurn: runner });
}
const kendraSession = { personId: 'kendra', childId: 'p_nora', childIds: ['p_nora', 'p_leo', 'p_max'] };

test('accepts a correctly signed in-call turn and returns a proposal that still requires confirmation', async () => {
  const b = bridge();
  const { raw, headers } = signed({ callId: 'call-1', turn: 1, message: 'Add a pickup for Nora tomorrow', session: kendraSession });
  const r = await b.handle(raw, headers);
  assert.equal(r.status, 200);
  assert.equal(r.body.requiresConfirmation, true);
  assert.equal(r.body.actions.length, 1);
  assert.equal(r.body.executed, false, 'bridge never executes a write');
});

test('rejects a bad signature and a stale timestamp', async () => {
  const b = bridge();
  const body = { callId: 'call-1', turn: 1, message: 'hi', session: kendraSession };
  const bad = signed(body); bad.headers['x-bridge-signature'] = 'deadbeef';
  assert.equal((await b.handle(bad.raw, bad.headers)).status, 401);
  const stale = signed(body, Date.now() - 10 * 60_000);
  assert.equal((await b.handle(stale.raw, stale.headers)).status, 401);
});

test('duplicate delivery of the same call turn returns the first receipt without re-running the model', async () => {
  let runs = 0;
  const b = bridge(async (req) => { runs++; return proposalRunner(req); });
  const { raw, headers } = signed({ callId: 'call-9', turn: 2, message: 'Add a pickup for Nora tomorrow', session: kendraSession });
  const first = await b.handle(raw, headers);
  const second = await b.handle(raw, headers);
  assert.equal(runs, 1, 'model ran once');
  assert.equal(second.body.duplicate, true);
  const { duplicate, ...rest } = second.body;
  assert.deepEqual(rest, first.body);
});

test('cross-family session is refused by the turn runner and yields no proposal', async () => {
  const b = bridge();
  const { raw, headers } = signed({ callId: 'call-2', turn: 1, message: 'Add a pickup', session: { personId: 'dana', childId: 'p_nora', childIds: ['p_jax'] } });
  const r = await b.handle(raw, headers);
  assert.equal(r.status, 200);
  assert.equal(r.body.actions.length, 0);
  assert.match(r.body.reply, /only help with children shared with you/);
});

test('cancellation produces no proposal and no write', async () => {
  const b = bridge();
  const { raw, headers } = signed({ callId: 'call-3', turn: 1, message: 'Cancel that, never mind', session: kendraSession });
  const r = await b.handle(raw, headers);
  assert.equal(r.body.actions.length, 0);
  assert.equal(r.body.executed, false);
});

test('a phone number or call id alone is not an identity: unsigned or session-less payloads are rejected', async () => {
  const b = bridge();
  const unsigned = JSON.stringify({ callId: 'call-4', turn: 1, message: 'hi', fromNumber: '+10000000000' });
  assert.equal((await b.handle(unsigned, {})).status, 401);
  const { raw, headers } = signed({ callId: 'call-4', turn: 1, message: 'hi', fromNumber: '+10000000000' });
  assert.equal((await b.handle(raw, headers)).status, 400, 'signed but no bound FridgeGraph session');
});

test('an interrupted call (abort event) clears dedupe state and returns no proposal', async () => {
  const b = bridge();
  const { raw, headers } = signed({ callId: 'call-5', turn: 1, event: 'call_ended', message: '', session: kendraSession });
  const r = await b.handle(raw, headers);
  assert.equal(r.status, 200);
  assert.equal(r.body.actions.length, 0);
  assert.equal(b.pendingReceipts(), 0);
});
