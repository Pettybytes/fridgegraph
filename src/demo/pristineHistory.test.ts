import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeed } from '../fixtures';
import { createCastV2 } from '../fixtures-cast-v2';
import { createSimulatedCalendar, createSimulatedCareFacts, createSimulatedCoordination } from '../fixtures-simulated';

const detroitDay = (at: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

test('every parent family child has a dense, distinct, deterministic 30-day recorded pickup history', () => {
  const base = createSeed(), cast = createCastV2(), history = createSimulatedCoordination();
  const children = [...new Set([...base.householdMembers.filter(m => m.role === 'child').map(m => m.personId), ...cast.household_members.filter(m => m.role === 'child').map(m => m.person_id)])];
  assert.equal(children.length, 10);
  const signatures = new Set<string>();
  for (const childId of children) {
    const jobs = history.coordination_jobs.filter(j => j.child_id === childId && j.id.startsWith('fx_job_'));
    assert.ok(jobs.length >= 18, `${childId}: needs at least 18 recorded requests, found ${jobs.length}`);
    const dates = [...new Set(jobs.map(j => detroitDay(j.created_at)))].sort();
    assert.equal(dates[0], '2026-10-05', `${childId}: oldest Detroit date`);
    assert.equal(dates.at(-1), '2026-11-03', `${childId}: newest Detroit date`);
    const signature = JSON.stringify(jobs.map(j => [j.created_at, j.status, history.attempts.filter(a => a.job_id === j.id).map(a => [a.channel, a.closed_reason])]));
    assert.ok(!signatures.has(signature), `${childId}: history repeats another child with names substituted`);
    signatures.add(signature);
    for (const job of jobs) {
      assert.ok(['confirmed', 'failed', 'awaiting_approval'].includes(job.status), `${job.id}: must not become dispatchable work`);
      for (const attempt of history.attempts.filter(a => a.job_id === job.id)) {
        assert.equal(attempt.destination_mode, 'TEST_RESPONDER');
        assert.ok(Date.parse(attempt.closed_at) >= Date.parse(attempt.at));
        assert.ok(Date.parse(attempt.at) >= Date.parse(job.created_at));
      }
    }
  }
  assert.equal(new Set(history.coordination_jobs.map(j => j.id)).size, history.coordination_jobs.length);
  assert.equal(new Set(history.coordination_jobs.map(j => j.idempotency_key)).size, history.coordination_jobs.length);
  assert.equal(new Set(history.attempts.map(a => a.id)).size, history.attempts.length);
  assert.deepEqual(createSimulatedCoordination(), history);
});

test('user-visible fixture copy contains no em dashes', () => {
  const base = createSeed();
  for (const [name, data] of Object.entries({ base, cast: createCastV2(), calendar: createSimulatedCalendar(), care: createSimulatedCareFacts() })) {
    assert.ok(!JSON.stringify(data).includes('\u2014'), `${name}: an em dash remains in fixture data`);
  }
});
