/**
 * Unit tests for TASK (teacher persona): the server allow-list in src/demo/personas.ts.
 *
 * Covers only the allow-list resolution itself — personaById / isReady / readyPersona — against a
 * temporary identity-map.json pointed to by IDENTITY_MAP_PATH, so no real Supabase Auth user or
 * network call is needed. The live "READY in the picker" claim (a real seeded identity) is a
 * deployment check for Bentley's window, not this file.
 *
 * No network call. Run with:
 *   node --import tsx --test src/demo/personas.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const DIR = mkdtempSync(join(tmpdir(), 'fridgegraph-personas-'));
const MAP_PATH = join(DIR, 'identity-map.json');
process.env.IDENTITY_MAP_PATH = MAP_PATH;

// Imported AFTER IDENTITY_MAP_PATH is set: identityMapPath() reads the env var lazily per call,
// but the module itself has no top-level state that would race the env assignment above.
const { DEMO_PERSONAS, personaById, isReady, readyPersona } = await import('./personas');

// readyPersonIds() caches by the file's mtimeMs. Two writes in the same test process can land in
// the same millisecond, which would hide a real content change behind a stale cache — so each
// write is stamped a full second apart rather than relying on wall-clock writes to differ.
let fakeMtimeSeconds = 1_700_000_000;
function writeMap(map: Record<string, string>) {
  writeFileSync(MAP_PATH, JSON.stringify(map));
  fakeMtimeSeconds += 1;
  utimesSync(MAP_PATH, fakeMtimeSeconds, fakeMtimeSeconds);
}

test('Ms. Whitfield is on the server allow-list exactly once, with a school-only role', () => {
  const matches = DEMO_PERSONAS.filter((p) => p.personId === 'p_whitfield');
  assert.equal(matches.length, 1);
  const whitfield = matches[0];
  assert.equal(whitfield.id, 'whitfield');
  assert.equal(whitfield.childId, 'p_nora');
  assert.equal(whitfield.parent, false);
  assert.equal(whitfield.guardian, undefined);
  // Informational only (the UI label), but it must not overclaim what the DB grant actually holds.
  assert.deepEqual([...whitfield.grants].sort(), ['school.read', 'school.report']);
});

test('an id not on the allow-list never resolves, regardless of identity-map content', () => {
  writeMap({ 'auth-uid-whitfield': 'p_whitfield' });
  assert.equal(personaById('ms-whitfield'), undefined);
  assert.equal(personaById('p_whitfield'), undefined); // the allow-list key is `id`, never `personId`
  assert.equal(readyPersona('not-a-real-persona'), null);
});

test('Ms. Whitfield is NOT ready before her identity is seeded', () => {
  writeMap({}); // no auth user minted yet
  const whitfield = personaById('whitfield')!;
  assert.equal(isReady(whitfield), false);
  assert.equal(readyPersona('whitfield'), null);
});

test('Ms. Whitfield becomes READY once (and only once) her personId appears in the identity map', () => {
  writeMap({ 'auth-uid-someone-else': 'p_mom', 'auth-uid-whitfield': 'p_whitfield' });
  const whitfield = personaById('whitfield')!;
  assert.equal(isReady(whitfield), true);
  assert.equal(readyPersona('whitfield')?.personId, 'p_whitfield');
});

test('reset/reseed removing her identity-map row makes her UNAVAILABLE again, not substituted', () => {
  writeMap({ 'auth-uid-whitfield': 'p_whitfield' });
  assert.equal(readyPersona('whitfield') !== null, true);
  writeMap({}); // simulates her identity row disappearing
  assert.equal(readyPersona('whitfield'), null);
});

test.after(() => {
  delete process.env.IDENTITY_MAP_PATH;
  rmSync(DIR, { recursive: true, force: true });
});
