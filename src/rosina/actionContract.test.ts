import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActionProposal, deriveIdempotencyKey, spokenStatus, type BuildProposalInput } from './actionContract';

const base: BuildProposalInput = {
  channel: 'voice',
  actorPersonId: 'kendra',
  authorizedChildIds: ['p_nora', 'p_leo'],
  childId: 'p_nora',
  intent: 'calendar.create',
  sourceFacts: ['Nora has an early dismissal tomorrow at 12:30 PM', 'No pickup is arranged yet'],
  proposedChange: { summary: "Add 'Early dismissal pickup' tomorrow 12:30 PM", args: { operation: 'create' } },
  affectedPeople: ['Nora Ellison', 'Andre Ellison'],
};

test('builds a complete shared-contract proposal that still requires parent confirmation', () => {
  const r = buildActionProposal(base);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const p = r.proposal;
  assert.equal(p.contractVersion, 1);
  assert.equal(p.channel, 'voice');
  assert.equal(p.actorPersonId, 'kendra');
  assert.equal(p.childId, 'p_nora');
  assert.equal(p.intent, 'calendar.create');
  assert.deepEqual(p.sourceFacts, base.sourceFacts);
  assert.equal(p.proposedChange.summary, base.proposedChange.summary);
  assert.deepEqual(p.affectedPeople, base.affectedPeople);
  assert.equal(p.confirmation.required, true);
  assert.equal(p.confirmation.channel, 'fridgegraph-app');
  assert.equal(p.confirmation.status, 'awaiting-parent');
  assert.equal(p.result.recordId, null, 'no record exists until the parent confirms and the backend saves');
  assert.equal(p.result.status, 'proposed');
  assert.ok(p.idempotencyKey.length >= 16);
});

test('the same contract shape is produced for typed and messaging channels', () => {
  for (const channel of ['typed', 'messaging'] as const) {
    const r = buildActionProposal({ ...base, channel });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.proposal.channel, channel);
      assert.equal(r.proposal.confirmation.required, true);
      assert.equal(r.proposal.result.recordId, null);
    }
  }
});

test('a child outside the actor authorization is refused with no proposal and no facts', () => {
  const r = buildActionProposal({ ...base, childId: 'p_malik' });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'child-not-authorized');
    assert.match(r.reply, /only help with children shared with you/);
  }
});

test('a proposal without source facts is refused: Rosina must not invent grounding', () => {
  const r = buildActionProposal({ ...base, sourceFacts: [] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'missing-source-facts');
});

test('idempotency keys are deterministic per actor+child+intent+change and differ across changes', () => {
  const a = buildActionProposal(base);
  const b = buildActionProposal({ ...base });
  assert.equal(a.ok && b.ok && a.proposal.idempotencyKey === b.proposal.idempotencyKey, true);
  const c = buildActionProposal({ ...base, proposedChange: { summary: 'A different change', args: {} } });
  assert.equal(a.ok && c.ok && a.proposal.idempotencyKey !== c.proposal.idempotencyKey, true);
  const explicit = buildActionProposal({ ...base, idempotencyKey: 'call-1:turn-2' });
  assert.equal(explicit.ok && explicit.proposal.idempotencyKey === 'call-1:turn-2', true);
  assert.equal(deriveIdempotencyKey(['kendra', 'p_nora']), deriveIdempotencyKey(['kendra', 'p_nora']));
});

test('pickup coverage is spoken of as requested, never arranged, until a record exists', () => {
  const r = buildActionProposal({ ...base, intent: 'pickup.coverage' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.proposal.result.status, 'requested');
  assert.match(spokenStatus(r.proposal), /requested/);
  assert.doesNotMatch(spokenStatus(r.proposal), /arranged|saved|booked/);
});
