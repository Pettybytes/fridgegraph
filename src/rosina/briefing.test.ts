/**
 * Caregiver Briefing tests — the trust boundary, shown by construction. Loretta (schedule + care)
 * sees more; Priya (care only) sees less; an unrelated caller is refused. Nothing appears that the
 * stubbed reads didn't provide; no coordinates ever; "scheduled", never presence. No network.
 * Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeBriefing, SCHEDULE_SCOPE, CAREPLAN_SCOPE, type BriefingContext } from './briefing';
import { gatherBriefing, type BriefingReaders, type ReadResult } from './briefingGather';

const NORA_EVENTS = [
  { title: 'School', start: '2026-10-26T08:15:00', end: '2026-10-26T15:00:00', location: 'Room 12, Lincoln Elementary', status: 'confirmed' },
  { title: 'Soccer practice', start: '2026-10-26T16:00:00', end: '2026-10-26T17:00:00', location: 'Maple Field', status: 'confirmed' },
];

function readers(over: Partial<BriefingReaders> = {}): BriefingReaders {
  return {
    childEvents: async () => ({ ok: true, value: NORA_EVENTS }),
    effectiveSchedule: async () => ({ ok: true, value: { parentId: 'p_kendra', source: 'WEEKLY' } }),
    careFacts: async () => ({ ok: true, value: [{ key: 'Allergy', value: 'peanuts', confidence: 'CONFIRMED' }] }),
    checkIn: async () => ({ ok: false }),
    pickupRole: async () => ({ ok: true, value: null }),
    ...over,
  };
}

const access = (scopes: string[], over: Partial<{ childName: string | null; hasGeometryAccess: boolean; isKnownChild: boolean }> = {}) => ({
  childName: 'Nora', scopes: new Set(scopes), hasGeometryAccess: false, isKnownChild: true, ...over,
});

const NO_COORDS = /-?\d{1,3}\.\d{3,}/; // a decimal that looks like a lat/lng

test('Loretta (schedule + care, approved pickup) gets a full briefing', async () => {
  const ctx = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_loretta',
    access: access([SCHEDULE_SCOPE, CAREPLAN_SCOPE]),
    readers: readers({ pickupRole: async () => ({ ok: true, value: { time: '12:30' } }) }),
  });
  const b = composeBriefing(ctx);
  assert.equal(b.refused, false);
  assert.equal(b.limitedAccess, false);
  assert.match(b.text, /Scheduled for 2026-10-26/);
  assert.match(b.text, /Room 12, Lincoln Elementary/);
  assert.match(b.text, /approved pickup at 12:30/);
  assert.match(b.text, /Allergy: peanuts \(recorded, confirmed\)/);
  // "scheduled", never presence.
  assert.doesNotMatch(b.text, /\bis at\b|\bpresent\b|\bwas seen\b/i);
  assert.doesNotMatch(b.text, NO_COORDS);
});

test('Priya (care notes only) sees care notes, NOT the schedule or check-in', async () => {
  let scheduleRead = false; let careRead = false;
  const ctx = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_priya',
    access: access([CAREPLAN_SCOPE]),
    readers: readers({
      childEvents: async () => { scheduleRead = true; return { ok: true, value: NORA_EVENTS }; },
      careFacts: async () => { careRead = true; return { ok: true, value: [{ key: 'Allergy', value: 'peanuts', confidence: 'CONFIRMED' }] }; },
    }),
  });
  const b = composeBriefing(ctx);
  assert.equal(scheduleRead, false, 'schedule must NOT be read without schedule.read');
  assert.equal(careRead, true);
  assert.match(b.text, /Allergy: peanuts/);
  assert.doesNotMatch(b.text, /Lincoln Elementary|Soccer practice/); // no schedule content
  assert.match(b.text, /Not visible to you:[\s\S]*schedule/);
  assert.doesNotMatch(b.text, /Check-in:/); // non-parent: no check-in section
  assert.doesNotMatch(b.text, NO_COORDS);
});

test('an unrelated caller is refused with one generic line, no oracle', async () => {
  let anyRead = false;
  const spy: BriefingReaders = {
    childEvents: async () => { anyRead = true; return { ok: true, value: [] }; },
    effectiveSchedule: async () => { anyRead = true; return { ok: false }; },
    careFacts: async () => { anyRead = true; return { ok: false }; },
    checkIn: async () => { anyRead = true; return { ok: false }; },
    pickupRole: async () => { anyRead = true; return { ok: false }; },
  };
  const ctx = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_stranger',
    access: access([], { isKnownChild: false, childName: null }),
    readers: spy,
  });
  const b = composeBriefing(ctx);
  assert.equal(b.refused, true);
  assert.equal(anyRead, false, 'no read is issued for a child the caller has no standing with');
  assert.match(b.text, /can't put together a briefing/);
  assert.equal(b.sections.length, 0);
});

test('nothing appears that the reads did not provide (empty reads → honest emptiness)', async () => {
  const ctx = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_loretta',
    access: access([SCHEDULE_SCOPE, CAREPLAN_SCOPE]),
    readers: readers({ childEvents: async () => ({ ok: true, value: [] }), careFacts: async () => ({ ok: true, value: [] }) }),
  });
  const b = composeBriefing(ctx);
  assert.match(b.text, /Nothing is scheduled/);
  assert.match(b.text, /No care notes are recorded/);
  assert.doesNotMatch(b.text, NO_COORDS);
});

test('no coordinates even WITH geometry access (v1 emits labels only)', async () => {
  const ctx = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_loretta',
    access: access([SCHEDULE_SCOPE], { hasGeometryAccess: true }),
    readers: readers(),
  });
  const b = composeBriefing(ctx);
  assert.doesNotMatch(b.text, NO_COORDS);
  assert.match(b.text, /Maple Field/); // label present
});

test('limited access is stated plainly, not padded', () => {
  const ctx: BriefingContext = {
    access: { childId: 'p_nora', childName: 'Nora', scopes: new Set([CAREPLAN_SCOPE]), hasGeometryAccess: false, isKnownChild: true },
    date: '2026-10-26', events: null, role: null,
    careNotes: [{ key: 'Allergy', value: 'peanuts', confidence: 'CONFIRMED' }], checkIn: null,
  };
  const b = composeBriefing(ctx);
  assert.equal(b.limitedAccess, true);
  assert.match(b.text, /You have limited access to Nora's details\./);
});

test('role from parenting time only when effectiveSchedule names the caller', async () => {
  const mine = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_kendra',
    access: access([SCHEDULE_SCOPE]),
    readers: readers({ effectiveSchedule: async () => ({ ok: true, value: { parentId: 'p_kendra', source: 'ARRANGEMENT' } }) }),
  });
  assert.match(composeBriefing(mine).text, /Nora is with you today \(an approved arrangement\)/);

  const notMine = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_andre',
    access: access([SCHEDULE_SCOPE]),
    readers: readers({ effectiveSchedule: async () => ({ ok: true, value: { parentId: 'p_kendra', source: 'WEEKLY' } }) }),
  });
  assert.doesNotMatch(composeBriefing(notMine).text, /with you today/);
});
