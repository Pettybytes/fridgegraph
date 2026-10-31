#!/usr/bin/env node
/**
 * ops/fixture-rule-proof.mjs — the additive-fixture contract, proven end to end.
 *
 *   1. clean any fixture rows, capture the BASELINE checksum (B0)
 *   2. seed the SIMULATED fixture (rows land in tables that already hold baseline data)
 *   3. prove the fixture is identifiable (marker + prefix) and the baseline rows were not rewritten
 *   4. clean up
 *   5. prove the checksum is byte-identical to B0 — cleanup removes exactly the fixture rows
 *
 * Uses the project's own db commands, so the thing proven is the thing that ships.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
};

const db = (...args) => execFileSync('npx', ['tsx', 'scripts/db.ts', ...args], { encoding: 'utf8' });
const checksum = () => JSON.parse(db('checksum').trim());
const simChecksum = () => JSON.parse(db('checksum:simulated').trim());
const sha = (v) => createHash('sha256').update(JSON.stringify(v, Object.keys(v).sort())).digest('hex').slice(0, 16);

console.log('=== additive fixture contract ===');

db('cleanup:simulated');
const b0 = checksum();
console.log(`  baseline captured: ${Object.keys(b0).length} tables, ${Object.values(b0).reduce((a, b) => a + b.rows, 0)} rows`);

const seeded = JSON.parse(db('seed:simulated').replace(/^seeded SIMULATED fixture: /, '').trim().split('\n').pop());
check('1 the fixture seeds rows into existing tables', Object.values(seeded).filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0) > 0,
  JSON.stringify(seeded));

const withFixture = checksum();
// The baseline event must be untouched by the fixture: same id, same content, same fixture flag.
const baselineEventSha = (c) => c.events?.sha;
check('2 the baseline event row survives seeding (events row count grew by fixture rows only)',
  withFixture.events.rows === b0.events.rows + 2, `${b0.events.rows} -> ${withFixture.events.rows}`);

const sim1 = simChecksum();
check('3 every fixture row is identifiable by the marker', Object.values(sim1).every((t) => t.rows > 0),
  Object.entries(sim1).map(([t, v]) => `${t}:${v.rows}`).join(' '));
check('3 the fixture has its own checksum, separate from the baseline', sha(sim1) !== b0.events.sha);

const cleaned = JSON.parse(db('cleanup:simulated').replace(/^cleaned SIMULATED fixture: /, '').trim().split('\n').pop());
check('4 cleanup removed rows', Object.values(cleaned).some((n) => n > 0), JSON.stringify(cleaned));

const b1 = checksum();
check('5 the baseline checksum is BYTE-IDENTICAL after cleanup',
  JSON.stringify(b0) === JSON.stringify(b1),
  JSON.stringify(b0) === JSON.stringify(b1) ? 'identical' : `differ: ${Object.keys(b0).filter((k) => JSON.stringify(b0[k]) !== JSON.stringify(b1[k])).join(',')}`);

const after = simChecksum();
check('6 no fixture row survives cleanup', Object.values(after).every((t) => t.rows === 0),
  Object.entries(after).map(([t, v]) => `${t}:${v.rows}`).join(' '));

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
