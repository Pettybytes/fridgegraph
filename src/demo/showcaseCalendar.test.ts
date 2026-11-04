import assert from 'node:assert/strict';
import test from 'node:test';
import { baseline } from '../../scripts/db';
import { resetSnapshot } from './reset';

const children = ['p_nora','p_leo','p_max','p_jax','p_emma','p_taylor','p_skye','p_micah','p_avery','p_malik'];
test('all ten showcase children have exactly one responsible parent every weekday and recorded handoffs', () => {
  const rows = baseline().parenting_schedules;
  for (const child of children) for (const day of ['MON','TUE','WED','THU','FRI','SAT','SUN']) {
    const matches = rows.filter(r => r.child_id === child && (r.weekdays as string[]).includes(day));
    assert.equal(matches.length, 1, `${child} ${day}: one responsible parent`);
    assert.ok(matches[0].handoff_time, `${child}: recorded handoff time`);
    assert.ok(matches[0].handoff_location, `${child}: recorded handoff location`);
  }
});
test('seed and Reset demo restore identical showcase care, availability and holiday records', () => {
  const b = baseline(), snap = resetSnapshot();
  for (const table of ['parenting_schedules','adult_availability','holiday_arrangements']) {
    assert.ok(b[table]?.length, `${table} is seeded`);
    const reset = [...(snap.fixtures[table] ?? []), ...(snap.cast[table] ?? [])];
    for (const row of b[table]) assert.ok(reset.some(r => JSON.stringify(r) === JSON.stringify(row)), `${table} restores ${row.id ?? row.child_id}`);
  }
});
test('each scheduled parent has explicit busy and free records in the November 2–8 demo week', () => {
  const b = baseline();
  for (const parent of new Set(b.parenting_schedules.map(r => r.parent_id))) {
    const rows = (b.adult_availability ?? []).filter(r => r.person_id === parent && String(r.start_at) >= '2026-11-02' && String(r.start_at) < '2026-11-09');
    for (const state of ['BUSY','FREE']) assert.ok(rows.some(r => r.state === state), `${parent}: ${state}`);
  }
});
