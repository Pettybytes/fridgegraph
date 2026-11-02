/**
 * The incident this file pins down: a seed run replaced a complete identity map with ONE identity,
 * and eleven personas went UNAVAILABLE with no error. Each test below mirrors one rule that failed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkMapSafety,
  mapFromResolved,
  planIdentities,
  readMapFile,
  writeMapThen,
  type StoredCredential,
} from './identityMap';

const emailFor = (p: { personId: string }) => `${p.personId}@example.invalid`;

test('an existing auth user with an unusable stored password is still in the map', () => {
  const people = [{ personId: 'p_mom' }, { personId: 'p_whitfield' }];
  const byEmail = new Map([
    ['p_mom@example.invalid', { id: 'user-1' }],
    ['p_whitfield@example.invalid', { id: 'user-2' }],
  ]);
  const creds: Record<string, StoredCredential> = {};

  const plan = planIdentities(people, byEmail, creds, emailFor);

  assert.equal(plan.resolved.get('p_mom'), 'user-1');
  assert.equal(plan.resolved.get('p_whitfield'), 'user-2', 'an existing user must not depend on a password');
  assert.equal(plan.toCreate.length, 0);
  // Both are reported as skipped for password purposes; neither is dropped from the map.
  assert.equal(plan.skipped.length, 2);

  const map = mapFromResolved(plan.resolved);
  assert.deepEqual(map, { 'user-1': 'p_mom', 'user-2': 'p_whitfield' });
});

test('a person with no auth user is queued for creation, not silently absent', () => {
  const plan = planIdentities(
    [{ personId: 'p_new' }],
    new Map(),
    {},
    emailFor,
  );
  assert.deepEqual(plan.toCreate, [{ personId: 'p_new' }]);
  assert.equal(plan.resolved.size, 0);
});

test('a map that drops an identity is refused unless loss is explicit', () => {
  const previous = { 'user-1': 'p_mom', 'user-2': 'p_whitfield' };
  const next = { 'user-1': 'p_mom' };

  const refused = checkMapSafety(previous, next);
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.code, 'LOSS');
  assert.deepEqual(refused.ok === false && refused.code === 'LOSS' ? refused.lost : [], ['p_whitfield']);

  const allowed = checkMapSafety(previous, next, true);
  assert.deepEqual(allowed, { ok: true });
});

test('an empty map is refused', () => {
  const verdict = checkMapSafety({ 'user-1': 'p_mom' }, {});
  assert.deepEqual(verdict, { ok: false, code: 'EMPTY' });
});

test('the previous map is restored when the database sync fails, and kept as last-good', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fg-identity-'));
  const path = join(dir, 'identity-map.json');
  const previousText = `${JSON.stringify({ 'user-1': 'p_mom' }, null, 2)}\n`;
  writeFileSync(path, previousText, { mode: 0o600 });

  await assert.rejects(
    writeMapThen(path, { 'user-1': 'p_mom', 'user-2': 'p_whitfield' }, previousText, async () => {
      throw new Error('identity_map sync failed: HTTP 500');
    }),
    /sync failed/,
  );

  assert.equal(readFileSync(path, 'utf8'), previousText, 'the working map must be restored');
  assert.equal(readMapFile(`${path}.last-good`)['user-1'], 'p_mom');
});

test('the previous map is restored when the write itself fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fg-identity-'));
  const path = join(dir, 'identity-map.json');
  const previousText = `${JSON.stringify({ 'user-1': 'p_mom' }, null, 2)}\n`;
  writeFileSync(path, previousText, { mode: 0o600 });

  let calls = 0;
  const deps = {
    writeFileSync: ((target: string, data: string, opts?: unknown) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      writeFileSync(target, data, opts as never);
    }) as typeof writeFileSync,
    chmodSync: (() => undefined) as typeof import('node:fs').chmodSync,
  };

  await assert.rejects(
    writeMapThen(path, { 'user-2': 'p_whitfield' }, previousText, () => undefined, deps),
    /disk full/,
  );
  assert.equal(readFileSync(path, 'utf8'), previousText);
  assert.equal(existsSync(`${path}.last-good`), true);
});
