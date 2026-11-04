import assert from 'node:assert/strict';
import test from 'node:test';
import { createCastV2 } from '../fixtures-cast-v2';
import { createSeed } from '../fixtures';

test('all authorized family children have calendar pickups through the next fourteen Detroit days', () => {
  const base = createSeed(), cast = createCastV2();
  const children = [...new Set([...base.householdMembers.filter(m => m.role === 'child').map(m => m.personId), ...cast.household_members.filter(m => m.role === 'child').map(m => m.person_id)])];
  assert.equal(children.length, 10);
  for (const child of children) {
    const pickups = cast.events.filter(e => e.child_id === child && e.id.startsWith('fx_pr_') && e.id.endsWith('_pickup'));
    assert.ok(pickups.some(e => e.start_at.startsWith('2026-10-05T')), `${child}: oldest requested day`);
    assert.ok(pickups.some(e => e.start_at.startsWith('2026-11-17T')), `${child}: next-fourteen-day endpoint`);
    assert.ok(pickups.length >= 31, `${child}: school-day coverage across the fixed window`);
  }
  assert.equal(new Set(cast.events.map(e => e.id)).size, cast.events.length);
  assert.deepEqual(createCastV2().events, cast.events);
});
