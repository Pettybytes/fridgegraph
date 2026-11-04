import assert from 'node:assert/strict';
import { test } from 'node:test';
const module = await import('./pickupStatus').catch(() => null);
const children = [{ id: 'p_nora', displayName: 'Nora Ellison', scopes: new Set(['pickup.request']) }, { id: 'p_leo', displayName: 'Leo Ellison', scopes: new Set(['pickup.request']) }];
const lens = JSON.stringify({ p_nora_pickups: [{ id: 'job_waiting', status: 'awaiting_approval', asOf: '2026-11-05' }, { id: 'job_approved', status: 'confirmed', asOf: '2026-11-04' }], p_leo_pickups: [{ id: 'job_leo', status: 'discovering', asOf: '2026-11-05' }] });
test('pickup state explanation binds the requested job ID to its current state', () => {
  assert.ok(module?.pickupStatusReply, 'authoritative pickup status formatting is missing');
  const reply = module.pickupStatusReply('What is the status of pickup job_waiting?', 'p_nora', children, lens);
  assert.match(reply!, /job_waiting.*awaiting parent approval/);
  assert.doesNotMatch(reply!, /parent approved/);
  assert.doesNotMatch(reply!, /job_approved/);
});
test('confirmed means parent approval, never pickup completion', () => {
  assert.ok(module?.pickupStatusReply, 'authoritative pickup status formatting is missing');
  assert.match(module.pickupStatusReply('What is pickup job_approved status?', 'p_nora', children, lens)!, /approval does not establish pickup completion/);
});
test('an explicit other authorized child overrides the selected child', () => {
  assert.ok(module?.pickupStatusReply, 'authoritative pickup status formatting is missing');
  const reply = module.pickupStatusReply('What is the status of Leo pickup?', 'p_nora', children, lens);
  assert.match(reply!, /job_leo/);
  assert.doesNotMatch(reply!, /job_waiting/);
});
