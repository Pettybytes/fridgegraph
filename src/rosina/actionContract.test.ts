import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActionProposal, changeUnavailableLine, deriveIdempotencyKey, holdingLine, museProposalAuthor, proposalLine, spokenStatus, PROPOSAL_AUTHOR_MODEL_ID, type BuildProposalInput, type ProposalAuthor } from './actionContract';

const author = museProposalAuthor();

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
  const r = buildActionProposal(base, author);
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
    const r = buildActionProposal({ ...base, channel }, author);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.proposal.channel, channel);
      assert.equal(r.proposal.confirmation.required, true);
      assert.equal(r.proposal.result.recordId, null);
    }
  }
});

test('a child outside the actor authorization is refused with no proposal and no facts', () => {
  const r = buildActionProposal({ ...base, childId: 'p_malik' }, author);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'child-not-authorized');
    assert.match(r.reply, /only help with children shared with you/);
  }
});

test('a proposal without source facts is refused: Rosina must not invent grounding', () => {
  const r = buildActionProposal({ ...base, sourceFacts: [] }, author);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'missing-source-facts');
});

test('idempotency keys are deterministic per actor+child+intent+change and differ across changes', () => {
  const a = buildActionProposal(base, author);
  const b = buildActionProposal({ ...base }, author);
  assert.equal(a.ok && b.ok && a.proposal.idempotencyKey === b.proposal.idempotencyKey, true);
  const c = buildActionProposal({ ...base, proposedChange: { summary: 'A different change', args: {} } }, author);
  assert.equal(a.ok && c.ok && a.proposal.idempotencyKey !== c.proposal.idempotencyKey, true);
  const explicit = buildActionProposal({ ...base, idempotencyKey: 'call-1:turn-2' }, author);
  assert.equal(explicit.ok && explicit.proposal.idempotencyKey === 'call-1:turn-2', true);
  assert.equal(deriveIdempotencyKey(['kendra', 'p_nora']), deriveIdempotencyKey(['kendra', 'p_nora']));
});

test('pickup coverage is spoken of as requested, never arranged, until a record exists', () => {
  const r = buildActionProposal({ ...base, intent: 'pickup.coverage' }, author);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.proposal.result.status, 'requested');
  assert.match(spokenStatus(r.proposal), /requested/);
  assert.doesNotMatch(spokenStatus(r.proposal), /arranged|saved|booked/);
});

test('only Muse may author a proposal: missing or non-Muse authorship is refused', () => {
  // Authorship cannot be caller-supplied: no trusted writer token, no proposal.
  const noAuthor = buildActionProposal(base);
  assert.equal(noAuthor.ok, false);
  if (!noAuthor.ok) assert.equal(noAuthor.reason, 'author-not-authorized');
  const forged = buildActionProposal(base, { modelId: 'gpt-4o-mini' } as unknown as ProposalAuthor);
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.reason, 'author-not-authorized');
  const ok = buildActionProposal(base, museProposalAuthor());
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.proposal.authoredBy, PROPOSAL_AUTHOR_MODEL_ID);
  if (ok.ok) assert.equal(ok.proposal.authoredBy, 'muse-spark-1.3', 'label is the real provider model id');
});

test('one-assistant spoken states: holding line names the selected child and claims nothing', () => {
  assert.equal(holdingLine('Nora'), "Let me check Nora's schedule and put together an option for you.");
  // Context switch: the name follows the selected child, never an assumption.
  assert.equal(holdingLine('Jax'), "Let me check Jax's schedule and put together an option for you.");
  assert.equal(holdingLine(undefined), 'Let me check the schedule and put together an option for you.');
  for (const line of [holdingLine('Nora'), holdingLine('Jax'), holdingLine(undefined)]) {
    assert.doesNotMatch(line, /give me a moment to confirm/i, 'confirming is the parent\u2019s job');
    assert.doesNotMatch(line, /saved|recorded|booked|arranged|done/i, 'no completed action is claimed');
  }
});

test('one-assistant spoken states: proposal line states the option and that nothing has changed yet', () => {
  const r = buildActionProposal(base, author);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const line = proposalLine(r.proposal);
  assert.match(line, /Early dismissal pickup/);
  assert.match(line, /review and confirm/i);
  assert.match(line, /Nothing has changed yet/);
  assert.doesNotMatch(line, /recorded|has been saved|is booked/i);
});

test('one-assistant spoken states: recorded is spoken only with the actual saved result', () => {
  const r = buildActionProposal(base, author);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.doesNotMatch(spokenStatus(r.proposal), /It's recorded/, 'no recorded claim before persistence');
  assert.match(spokenStatus(r.proposal), /nothing is recorded/, 'states plainly that nothing is recorded yet');
  const saved = { ...r.proposal, result: { recordId: 'evt_42', status: 'saved' as const } };
  const line = spokenStatus(saved);
  assert.match(line, /recorded/i);
  assert.match(line, /evt_42/, 'uses the actual saved result');
});

test('one-assistant spoken states: no spoken line ever names a provider or model', () => {
  const r = buildActionProposal(base, author);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const lines = [
    holdingLine('Nora'), proposalLine(r.proposal), changeUnavailableLine(),
    spokenStatus(r.proposal),
    spokenStatus({ ...r.proposal, result: { recordId: 'evt_1', status: 'saved' as const } }),
  ];
  for (const line of lines) assert.doesNotMatch(line, /claude|retell|spark|gpt|llm|language model|provider/i, line);
  assert.match(changeUnavailableLine(), /nothing has changed/i);
});
