/**
 * Detroit calendar-day helpers + the Add-a-Villager validFrom resolution. Regression for evidence
 * 72: an unspecified start date in the Detroit evening (when UTC is already tomorrow) must resolve to
 * Detroit TODAY, not UTC tomorrow. No network. Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detroitToday, resolveVillagerValidFrom } from './localTime';

// 22:42 ET on 2026-11-01 — the evidence-72 instant; UTC is already 2026-11-02.
const observedEvening = new Date('2026-11-02T03:42:00Z');
// 22:30 ET on 2026-11-14 — an unambiguous EST evening; UTC is already 2026-11-15.
const midMonthEvening = new Date('2026-11-15T03:30:00Z');

test('detroitToday returns the Detroit calendar day, not the UTC day', () => {
  assert.equal(observedEvening.toISOString().slice(0, 10), '2026-11-02'); // UTC day (tomorrow)
  assert.equal(detroitToday(observedEvening), '2026-11-01'); // Detroit day (today)
  assert.equal(midMonthEvening.toISOString().slice(0, 10), '2026-11-15');
  assert.equal(detroitToday(midMonthEvening), '2026-11-14');
});

test('REGRESSION: unspecified start date at 22:30 ET resolves to Detroit today, not UTC tomorrow', () => {
  assert.equal(resolveVillagerValidFrom(null, midMonthEvening), '2026-11-14');
  assert.equal(resolveVillagerValidFrom(undefined, observedEvening), '2026-11-01');
  assert.equal(resolveVillagerValidFrom('', observedEvening), '2026-11-01');
});

test('a malformed model date is not trusted — resolves to Detroit today', () => {
  assert.equal(resolveVillagerValidFrom('next week', midMonthEvening), '2026-11-14');
  assert.equal(resolveVillagerValidFrom('2026-13-40', midMonthEvening), '2026-11-14');
});

test('a past date cannot start a new grant — clamped to Detroit today', () => {
  assert.equal(resolveVillagerValidFrom('2020-01-01', midMonthEvening), '2026-11-14');
});

test('an explicitly requested today-or-future date is preserved', () => {
  assert.equal(resolveVillagerValidFrom('2026-11-14', midMonthEvening), '2026-11-14'); // today
  assert.equal(resolveVillagerValidFrom('2026-12-25', midMonthEvening), '2026-12-25'); // future
});
