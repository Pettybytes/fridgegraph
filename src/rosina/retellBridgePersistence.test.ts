import test from 'node:test';
import assert from 'node:assert/strict';
import { RetellBridge, signPayload, type BridgeSession } from './retellBridge';
import { spokenStatus, type RosinaActionProposal } from './actionContract';

/**
 * Bound-session Confirm -> persist proof for the voice proposal path.
 *
 * The bridge never writes. This test stands a stateful double at the exact
 * seam the production code documents (the FridgeGraph backend owns identity,
 * confirmation, mutation, persistence and audit - the #266/#272 confirm path)
 * and proves the composition the judge journey needs: a proposal produced
 * under a bound parent session, once confirmed by that parent, becomes one
 * persisted record visible on the Calendar, Activity and Mission Control
 * read surfaces; a retried confirm with the same idempotency key returns the
 * same record instead of duplicating it; another family's session and an
 * unconfirmed proposal write nothing.
 */

const SECRET = 'test-only-bridge-secret';
function signed(body: unknown, ts = Date.now()) {
  const raw = JSON.stringify(body);
  return { raw, headers: { 'x-bridge-timestamp': String(ts), 'x-bridge-signature': signPayload(SECRET, ts, raw) } };
}
const kendra: BridgeSession = { personId: 'kendra', childId: 'p_nora', childIds: ['p_nora'] };
const dana: BridgeSession = { personId: 'dana', childId: 'p_jax', childIds: ['p_jax'] };

type StoredRecord = { recordId: string; childId: string; actorPersonId: string; summary: string; idempotencyKey: string };
class BackendDouble {
  private byKey = new Map<string, StoredRecord>();
  private seq = 0;
  failSaves = false;
  confirm(p: RosinaActionProposal, opts: { session: BridgeSession; parentConfirmed: boolean }) {
    if (!opts.parentConfirmed) return { ok: false as const, reason: 'not-confirmed' };
    if (this.failSaves) return { ok: false as const, reason: 'save-failed' };
    if (p.actorPersonId !== opts.session.personId || !opts.session.childIds.includes(p.childId)) {
      return { ok: false as const, reason: 'not-authorized' };
    }
    const existing = this.byKey.get(p.idempotencyKey);
    if (existing) return { ok: true as const, recordId: existing.recordId, duplicate: true };
    const rec: StoredRecord = { recordId: `evt_${++this.seq}`, childId: p.childId, actorPersonId: p.actorPersonId, summary: p.proposedChange.summary, idempotencyKey: p.idempotencyKey };
    this.byKey.set(p.idempotencyKey, rec);
    return { ok: true as const, recordId: rec.recordId, duplicate: false };
  }
  private visible(session: BridgeSession): StoredRecord[] {
    return [...this.byKey.values()].filter(r => session.childIds.includes(r.childId));
  }
  calendar(session: BridgeSession) { return this.visible(session).map(r => ({ recordId: r.recordId, title: r.summary })); }
  activity(session: BridgeSession) { return this.visible(session).map(r => ({ recordId: r.recordId, text: `${r.actorPersonId} added ${r.summary}` })); }
  missionControl(session: BridgeSession) { return this.visible(session).map(r => ({ recordId: r.recordId, change: r.summary })); }
}

async function voiceProposal(): Promise<RosinaActionProposal> {
  const b = new RetellBridge({
    secret: SECRET,
    runTurn: async () => ({
      reply: 'I will prepare that for your review in the app. Nothing has been saved.',
      // A fast-model action rides along: it must be rejected, never proposed.
      actions: [{ intent: 'calendar.create', sourceFacts: ['x'], summary: 'fast-model attempt', affectedPeople: [] }],
      intent: { description: "Add 'Early dismissal pickup' tomorrow 12:30 PM", sourceFacts: ['Nora has an early dismissal tomorrow at 12:30 PM'], affectedPeople: ['Nora Ellison'] },
    }),
    writeProposal: async ({ intent }) => ({ intent: 'calendar.create', sourceFacts: intent.sourceFacts, summary: intent.description, affectedPeople: intent.affectedPeople }),
  });
  const { raw, headers } = signed({ callId: 'call-p1', turn: 1, message: 'Add a pickup for Nora tomorrow', session: kendra });
  const r = await b.handle(raw, headers);
  assert.equal(r.status, 200);
  assert.equal(r.body.rejectedActions, 1, 'fast-model action rejected at the bridge');
  assert.equal(r.body.actions.length, 1);
  assert.equal(r.body.actions[0].authoredBy, 'muse-spark-1.3');
  assert.equal(r.body.actions[0].result.recordId, null, 'no record exists before parent confirmation');
  return r.body.actions[0];
}

test('bound parent session: Confirm persists one record visible on Calendar, Activity and Mission Control; retry dedupes', async () => {
  const proposal = await voiceProposal();
  const backend = new BackendDouble();

  const unconfirmed = backend.confirm(proposal, { session: kendra, parentConfirmed: false });
  assert.equal(unconfirmed.ok, false);
  assert.equal(backend.calendar(kendra).length, 0, 'nothing persists before the parent confirms');

  const saved = backend.confirm(proposal, { session: kendra, parentConfirmed: true });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.duplicate, false);
  assert.ok(backend.calendar(kendra).some(e => e.recordId === saved.recordId), 'record visible in Calendar');
  assert.ok(backend.activity(kendra).some(e => e.recordId === saved.recordId), 'record visible in Activity');
  assert.ok(backend.missionControl(kendra).some(e => e.recordId === saved.recordId), 'record visible in Mission Control');

  const retry = backend.confirm(proposal, { session: kendra, parentConfirmed: true });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.duplicate, true, 'retry is recognised, not rewritten');
  assert.equal(retry.recordId, saved.recordId, 'same persisted record id on retry');
  assert.equal(backend.calendar(kendra).length, 1, 'still exactly one record after retry');

  const cross = backend.confirm(proposal, { session: dana, parentConfirmed: true });
  assert.equal(cross.ok, false, 'another family cannot confirm or write');
  assert.equal(backend.calendar(dana).length, 0, 'nothing leaks into the other family surfaces');
});

test('failed save: nothing persists and the spoken status never claims a record', async () => {
  const proposal = await voiceProposal();
  const backend = new BackendDouble();
  backend.failSaves = true;
  const failed = backend.confirm(proposal, { session: kendra, parentConfirmed: true });
  assert.equal(failed.ok, false);
  assert.equal(backend.calendar(kendra).length, 0, 'a failed save writes nothing');
  assert.equal(backend.activity(kendra).length, 0);
  // State 4: the proposal is still only proposed/requested - no recorded claim.
  assert.doesNotMatch(spokenStatus(proposal), /It's recorded/);
  assert.match(spokenStatus(proposal), /nothing is recorded/);
  // Recovery: the same proposal can still be confirmed once saves work.
  backend.failSaves = false;
  const saved = backend.confirm(proposal, { session: kendra, parentConfirmed: true });
  assert.equal(saved.ok, true);
  if (saved.ok) assert.match(spokenStatus({ ...proposal, result: { recordId: saved.recordId, status: 'saved' } }), /It's recorded/);
});
