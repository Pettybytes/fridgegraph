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
  // The fast voice model gathers intent only; the proposal is written by the
  // Muse writer slot (stubbed deterministically here), never by the runner.
  return { reply: 'Review this change, then confirm. Nothing has been saved.', actions: [], intent: { description: "Add 'Early dismissal pickup' tomorrow 12:30 PM", sourceFacts: ['Nora has an early dismissal tomorrow at 12:30 PM'], affectedPeople: ['Nora Ellison'] } };
};
function bridge(runner: TurnRunner = proposalRunner) {
  return new RetellBridge({ secret: SECRET, runTurn: runner,
    writeProposal: async ({ intent }) => ({ intent: 'calendar.create', sourceFacts: intent.sourceFacts, summary: intent.description, affectedPeople: intent.affectedPeople ?? [] }) });
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
  const a = r.body.actions[0];
  assert.equal(a.contractVersion, 1);
  assert.equal(a.channel, 'voice');
  assert.equal(a.actorPersonId, 'kendra');
  assert.equal(a.childId, 'p_nora');
  assert.equal(a.confirmation.required, true);
  assert.equal(a.result.recordId, null);
  assert.equal(a.result.status, 'proposed');
  assert.ok(a.idempotencyKey.length >= 16);
});

test('a voice action from the fast model aimed at an unauthorized child is rejected, never proposed', async () => {
  const b = bridge(async () => ({ reply: 'Here is a proposal.', actions: [{ intent: 'calendar.create', childId: 'p_malik', sourceFacts: ['x'], summary: 'Add an event for Malik', affectedPeople: [] }] }));
  const { raw, headers } = signed({ callId: 'call-7', turn: 1, message: 'Add an event for Malik', session: kendraSession });
  const r = await b.handle(raw, headers);
  assert.equal(r.body.actions.length, 0);
  assert.equal(r.body.rejectedActions, 1);
  assert.equal(r.body.requiresConfirmation, false);
  assert.equal(r.body.executed, false);
});

test('an action returned by the fast (Retell) model is rejected and never labelled Claude-authored', async () => {
  // Well-grounded and in-scope, but produced by the wrong model: still refused.
  const b = bridge(async () => ({ reply: 'Done, I added it for you.', actions: [{ intent: 'calendar.create', sourceFacts: ['Nora has an early dismissal tomorrow at 12:30 PM'], summary: "Add 'Early dismissal pickup' tomorrow 12:30 PM", affectedPeople: ['Nora Ellison'] }] }));
  const { raw, headers } = signed({ callId: 'call-7b', turn: 1, message: 'Add a pickup for Nora tomorrow', session: kendraSession });
  const r = await b.handle(raw, headers);
  assert.equal(r.status, 200);
  assert.equal(r.body.actions.length, 0, 'no proposal may enter from the fast model');
  assert.equal(r.body.rejectedActions, 1);
  assert.equal(r.body.proposalUnavailable, true);
  assert.equal(r.body.requiresConfirmation, false);
  assert.equal(r.body.attribution.proposal, undefined, 'nothing is labelled as Claude-authored');
  assert.equal(r.body.executed, false);
});

test('an ungrounded voice action (no source facts) is dropped by the contract', async () => {
  const b = bridge(async () => ({ reply: 'Here is a proposal.', actions: [{ intent: 'calendar.create', sourceFacts: [], summary: 'Add an event', affectedPeople: [] }] }));
  const { raw, headers } = signed({ callId: 'call-8', turn: 1, message: 'Add an event', session: kendraSession });
  const r = await b.handle(raw, headers);
  assert.equal(r.body.actions.length, 0);
  assert.equal(r.body.rejectedActions, 1);
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

test('gathered intent goes to the Muse proposal writer; the fast reply never claims a save', async () => {
  const b = new RetellBridge({ secret: SECRET, runTurn: async () => ({
    reply: 'I will prepare that pickup change for your review in the app.',
    actions: [],
    intent: { description: 'Arrange pickup for Nora early dismissal tomorrow 12:30 PM', sourceFacts: ['Tomorrow Nora has an early dismissal at 12:30 PM and no pickup is arranged yet'], affectedPeople: ['Nora Ellison'] },
  }), writeProposal: async ({ intent }) => ({ intent: 'pickup.coverage', sourceFacts: intent.sourceFacts, summary: intent.description, affectedPeople: intent.affectedPeople }) });
  const { raw, headers } = signed({ callId: 'call-h1', turn: 1, message: 'Can you handle Nora pickup tomorrow?', session: kendraSession });
  const r = await b.handle(raw, headers);
  assert.equal(r.status, 200);
  assert.equal(r.body.actions.length, 1);
  assert.equal(r.body.actions[0].authoredBy, 'muse-spark-1.3');
  assert.equal(r.body.actions[0].result.status, 'requested');
  assert.equal(r.body.actions[0].result.recordId, null);
  assert.equal(r.body.attribution.proposal, 'muse-spark-1.3');
  assert.equal(r.body.attribution.reply, 'retell-model');
  assert.equal(r.body.executed, false);
  assert.doesNotMatch(r.body.reply, /has been saved|is booked|is arranged/i);
});

test('a Muse writer failure yields no proposal and no claim, never a phantom write', async () => {
  const b = new RetellBridge({ secret: SECRET, runTurn: async () => ({
    reply: 'Let me prepare that for you.', actions: [],
    intent: { description: 'Add a calendar event', sourceFacts: ['fact'], affectedPeople: [] },
  }), writeProposal: async () => { throw new Error('provider down'); } });
  const { raw, headers } = signed({ callId: 'call-h2', turn: 1, message: 'Add an event', session: kendraSession });
  const r = await b.handle(raw, headers);
  assert.equal(r.status, 200);
  assert.equal(r.body.actions.length, 0);
  assert.equal(r.body.proposalUnavailable, true);
  assert.equal(r.body.executed, false);
});

test('a provider failure in the turn itself is a clean refusal with no actions', async () => {
  const b = bridge(async () => { throw new Error('provider timeout'); });
  const { raw, headers } = signed({ callId: 'call-h3', turn: 1, message: 'Who is picking Nora up today?', session: kendraSession });
  const r = await b.handle(raw, headers);
  assert.equal(r.status, 502);
  assert.equal(r.body.actions.length, 0);
  assert.equal(r.body.executed, false);
  assert.match(r.body.reply, /unavailable/);
});
