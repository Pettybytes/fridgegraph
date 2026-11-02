import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detroitDay } from '../derive';

// The bug this guards: filing an evening event on the wrong calendar day. A UTC slice of
// `2026-11-01T19:30-05:00` yields `2026-11-02`, so the map would show tomorrow's event today.
test('an event after 7 PM Eastern stays on its Detroit day', () => {
  assert.equal(detroitDay('2026-11-01T19:30:00-05:00'), '2026-11-01');
});

test('the same instant written in UTC also lands on the Detroit day', () => {
  assert.equal(detroitDay('2026-11-02T00:30:00Z'), '2026-11-01');
});

test('a late-evening event in summer (EDT) is not shifted either', () => {
  assert.equal(detroitDay('2026-07-01T20:30:00-04:00'), '2026-07-01');
  assert.equal(detroitDay('2026-07-02T00:30:00Z'), '2026-07-01');
});

test('a stored wall-clock value without a zone is taken as Detroit time', () => {
  assert.equal(detroitDay('2026-11-01T19:30:00'), '2026-11-01');
});

test('the naive UTC slice WOULD have been wrong — this is the regression', () => {
  const value = '2026-11-01T19:30:00-05:00';
  const naive = value.slice(0, 10);
  const correct = detroitDay(value);
  assert.equal(naive, '2026-11-01', 'slice of an offset string happens to match here');
  // and the case that actually broke: a Z value late in the Eastern evening
  assert.equal('2026-11-02T00:30:00Z'.slice(0, 10), '2026-11-02');
  assert.equal(detroitDay('2026-11-02T00:30:00Z'), '2026-11-01');
  assert.notEqual(detroitDay('2026-11-02T00:30:00Z'), '2026-11-02T00:30:00Z'.slice(0, 10));
});
