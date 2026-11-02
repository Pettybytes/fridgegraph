/**
 * Caregiver Briefing tests — the trust boundary, grounded in the ACTUAL seeded grants on p_nora
 * (supabase/migrations/0002_seed.sql, src/fixtures.ts):
 *   Kendra  (parent)       — full: schedule + care + check-in + parenting-time role
 *   Priya   (sitter)       — ['supervise.request','schedule.read','careplan.read'] → schedule + care
 *   Loretta (grandmother)  — ['pickup.request','schedule.read','goals.read']       → schedule, NO care
 *   unrelated caller       — refused
 * Each caregiver's briefing is exactly their own grant; neither Loretta nor Priya dominates — Priya
 * sees care notes (careplan.read), Loretta does not; both see the schedule. No network.
 * Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeBriefing, type BriefingContext } from './briefing';
import { gatherBriefing, type BriefingReaders } from './briefingGather';

// Real seeded grants on p_nora.
const KENDRA = ['schedule.read', 'careplan.read', 'pickup.request', 'pickup.verify', 'goals.read', 'contacts.read'];
const PRIYA = ['supervise.request', 'schedule.read', 'careplan.read'];
const LORETTA = ['pickup.request', 'schedule.read', 'goals.read'];

const NORA_EVENTS = [
  { title: 'School', start: '2026-10-26T08:15:00', end: '2026-10-26T15:00:00', location: 'Room 12, Lincoln Elementary', status: 'confirmed' },
  { title: 'Soccer practice', start: '2026-10-26T16:00:00', end: '2026-10-26T17:00:00', location: 'Maple Field', status: 'confirmed' },
];

function readers(over: Partial<BriefingReaders> = {}): BriefingReaders {
  return {
    childEvents: async () => ({ ok: true, value: NORA_EVENTS }),
    effectiveSchedule: async () => ({ ok: true, value: { parentId: 'p_kendra', source: 'WEEKLY' } }),
    careFacts: async () => ({ ok: true, value: [{ key: 'Allergy', value: 'peanuts', confidence: 'CONFIRMED' }] }),
    checkIn: async () => ({ ok: false }), // non-parent default
    pickupRole: async () => ({ ok: true, value: null }), // confirmation read is a gap; null in prod
    ...over,
  };
}

const access = (scopes: string[], over: Partial<{ childName: string | null; hasGeometryAccess: boolean; isKnownChild: boolean }> = {}) => ({
  childName: 'Nora', scopes: new Set(scopes), hasGeometryAccess: false, isKnownChild: true, ...over,
});

const NO_COORDS = /-?\d{1,3}\.\d{3,}/; // a decimal that looks like a lat/lng

test('Priya (sitter: schedule + care) sees the schedule AND care notes, no check-in', async () => {
  let scheduleRead = false; let careRead = false;
  const ctx = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_priya',
    access: access(PRIYA),
    readers: readers({
      childEvents: async () => { scheduleRead = true; return { ok: true, value: NORA_EVENTS }; },
      careFacts: async () => { careRead = true; return { ok: true, value: [{ key: 'Allergy', value: 'peanuts', confidence: 'CONFIRMED' }] }; },
    }),
  });
  const b = composeBriefing(ctx);
  assert.equal(scheduleRead, true);
  assert.equal(careRead, true);
  assert.equal(b.limitedAccess, false);
  assert.match(b.text, /Scheduled for 2026-10-26/);
  assert.match(b.text, /Room 12, Lincoln Elementary/);
  assert.match(b.text, /Allergy: peanuts \(recorded, confirmed\)/);
  assert.doesNotMatch(b.text, /Check-in:/); // non-parent
  assert.doesNotMatch(b.text, /\bis at\b|\bpresent\b|\bwas seen\b/i);
  assert.doesNotMatch(b.text, NO_COORDS);
});

test('Loretta (grandmother: schedule, NO careplan) sees the schedule but NOT care notes', async () => {
  let careRead = false;
  const ctx = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_gma',
    access: access(LORETTA),
    readers: readers({ careFacts: async () => { careRead = true; return { ok: true, value: [{ key: 'Allergy', value: 'peanuts', confidence: 'CONFIRMED' }] }; } }),
  });
  const b = composeBriefing(ctx);
  assert.equal(careRead, false, 'care notes are NOT read without careplan.read');
  assert.match(b.text, /Scheduled for 2026-10-26/);
  assert.match(b.text, /Room 12, Lincoln Elementary/);
  assert.doesNotMatch(b.text, /Allergy|peanuts/); // no care content
  assert.match(b.text, /Not visible to you:[\s\S]*care notes/);
  assert.equal(b.limitedAccess, false, 'seeing the full schedule is not "limited"');
  assert.doesNotMatch(b.text, NO_COORDS);
});

test('a parent (Kendra) additionally sees the check-in and parenting-time role', async () => {
  const ctx = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_kendra',
    access: access(KENDRA),
    readers: readers({
      checkIn: async () => ({ ok: true, value: { recorded: false, label: 'No check-in recorded yet.' } }),
      effectiveSchedule: async () => ({ ok: true, value: { parentId: 'p_kendra', source: 'ARRANGEMENT' } }),
    }),
  });
  const b = composeBriefing(ctx);
  assert.match(b.text, /Scheduled for 2026-10-26/);
  assert.match(b.text, /Allergy: peanuts/);
  assert.match(b.text, /Check-in:/);
  assert.match(b.text, /Nora is with you today \(an approved arrangement\)/);
  assert.equal(b.limitedAccess, false);
});

test('an unrelated caller is refused with one generic line, no reads, no oracle', async () => {
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
  assert.equal(anyRead, false);
  assert.match(b.text, /can't put together a briefing/);
  assert.equal(b.sections.length, 0);
});

test('nothing appears that the reads did not provide (empty reads → honest emptiness)', async () => {
  const ctx = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_priya',
    access: access(PRIYA),
    readers: readers({ childEvents: async () => ({ ok: true, value: [] }), careFacts: async () => ({ ok: true, value: [] }) }),
  });
  const b = composeBriefing(ctx);
  assert.match(b.text, /Nothing is scheduled/);
  assert.match(b.text, /No care notes are recorded/);
  assert.doesNotMatch(b.text, NO_COORDS);
});

test('no coordinates even WITH geometry access (v1 emits labels only)', async () => {
  const ctx = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_gma',
    access: access(LORETTA, { hasGeometryAccess: true }),
    readers: readers(),
  });
  const b = composeBriefing(ctx);
  assert.doesNotMatch(b.text, NO_COORDS);
  assert.match(b.text, /Maple Field/); // label present
});

test('limited access is flagged ONLY when the caller sees nothing substantive', () => {
  // A caller whose grant surfaces nothing in the briefing (e.g. goals-only): no schedule, no care,
  // no role, no check-in → genuinely limited, said plainly.
  const ctx: BriefingContext = {
    access: { childId: 'p_nora', childName: 'Nora', scopes: new Set(['goals.read']), hasGeometryAccess: false, isKnownChild: true },
    date: '2026-10-26', events: null, role: null, careNotes: null, checkIn: null,
  };
  const b = composeBriefing(ctx);
  assert.equal(b.limitedAccess, true);
  assert.match(b.text, /You have limited access to Nora's details\./);
  assert.match(b.text, /Not visible to you:[\s\S]*schedule/);
});

test('role from parenting time only when effectiveSchedule names the caller', async () => {
  const notMine = await gatherBriefing({
    childId: 'p_nora', date: '2026-10-26', callerId: 'p_andre',
    access: access(['schedule.read']),
    readers: readers({ effectiveSchedule: async () => ({ ok: true, value: { parentId: 'p_kendra', source: 'WEEKLY' } }) }),
  });
  assert.doesNotMatch(composeBriefing(notMine).text, /with you today/);
});
