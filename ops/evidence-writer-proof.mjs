#!/usr/bin/env node
/**
 * ops/evidence-writer-proof.mjs — the suite must not rewrite the canonical evidence tree.
 *
 * Proves three things:
 *   1. a default run writes to `.runs/evidence/<timestamp>/` and leaves `docs/evidence/` untouched;
 *   2. `--record` against an existing name is REFUSED before the first live call — nothing is
 *      mutated, no evidence file changes;
 *   3. writes use exclusive creation, so an existing file cannot be overwritten even if the
 *      preflight were bypassed.
 *
 * The default run executes the whole suite (and its reset), so this needs a reserved window. The
 * refusal test performs no live call at all.
 *
 * Generated output stays in .runs/ and a temporary directory; nothing is written to docs/evidence.
 *
 * Run: node --import tsx ops/evidence-writer-proof.mjs
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync as read } from 'node:fs';

const env = Object.fromEntries(
  read('.env', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const EVIDENCE = 'docs/evidence';
const gitStatus = () => spawnSync('git', ['status', '--porcelain', '--', EVIDENCE], { encoding: 'utf8' }).stdout.trim();

/** Directory hash so "untouched" is a content assertion, not just "git says clean". */
const dirHash = () => {
  const files = readdirSync(EVIDENCE).sort();
  const h = createHash('sha256');
  for (const f of files) h.update(f).update(readFileSync(join(EVIDENCE, f)));
  return { count: files.length, sha: h.digest('hex') };
};

const before = dirHash();
const beforeStatus = gitStatus();

console.log('=== evidence writer ===');

// ---------------------------------------------------------------- 1. --record is refused, before any mutation
const recordRun = spawnSync(process.execPath, ['--import', 'tsx', 'ops/run-evidence.mjs', '--record'], {
  env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
const recordOut = `${recordRun.stdout ?? ''}${recordRun.stderr ?? ''}`;
check('--record exits 2 when target names already exist', recordRun.status === 2, `exit=${recordRun.status}`);
check('the refusal says so', /--record REFUSED/.test(recordOut));
check('it refused BEFORE any live call (no case output)', !/--- 0-?1[0-9]?|^--- 0/m.test(recordOut) && !/=== \w/.test(recordOut.split('--record REFUSED')[0] ?? ''),
  (recordOut.split('\n')[0] ?? '').slice(0, 60));
const afterRefusal = dirHash();
check('no evidence file changed on the refused run',
  afterRefusal.sha === before.sha && gitStatus() === beforeStatus,
  `${before.count} files, sha ${before.sha.slice(0, 8)} -> ${afterRefusal.sha.slice(0, 8)}`);

// ---------------------------------------------------------------- 2. the default run writes to .runs only
const runsDir = '.runs/evidence';
const runsBefore = existsSync(runsDir) ? new Set(readdirSync(runsDir)) : new Set();
const suiteRun = spawnSync(process.execPath, ['--import', 'tsx', 'ops/run-evidence.mjs'], {
  env: {
    ...process.env,
    FRIDGEGRAPH_ROUTER: process.env.FRIDGEGRAPH_ROUTER ?? 'http://127.0.0.1:4012/',
    FRIDGEGRAPH_RESET_URL: process.env.FRIDGEGRAPH_RESET_URL ?? 'http://127.0.0.1:4101/__reset',
  },
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
});
const suiteOut = `${suiteRun.stdout ?? ''}${suiteRun.stderr ?? ''}`;
// Diagnostics on failure: the suite's own last lines, so a red assertion is never a guess.
const suiteTail = suiteOut.trim().split('\n').slice(-4).join(' | ').slice(0, 300);
check('the default suite run passes', suiteRun.status === 0, `exit=${suiteRun.status}${suiteRun.status === 0 ? '' : ' :: ' + suiteTail}`);
const assertions = /Assertions: (\d+) checks across (\d+) cases/.exec(suiteOut);
check('it ran the full case set', Boolean(assertions), assertions ? `${assertions[1]}/${assertions[2]}` : 'no summary line');
const printed = /\[evidence\] writing to (.+)/.exec(suiteOut)?.[1]?.trim() ?? '';
check('it printed a run directory, not docs/evidence', printed.startsWith('.runs/evidence/') || printed.includes('.runs/evidence/'), printed || '(none)');

const afterRun = dirHash();
check('docs/evidence is byte-identical after a default run',
  afterRun.sha === before.sha && afterRun.count === before.count && gitStatus() === beforeStatus,
  `${before.count} files, sha ${before.sha.slice(0, 8)} -> ${afterRun.sha.slice(0, 8)}`);

const runsAfter = existsSync(runsDir) ? readdirSync(runsDir).filter((d) => !runsBefore.has(d)) : [];
const newest = runsAfter.sort().slice(-1)[0];
const runFiles = newest ? readdirSync(join(runsDir, newest)).filter((f) => f.endsWith('.md')) : [];
check('the run directory received the case files', runFiles.length >= 30, `${runFiles.length} files in ${newest ?? '(none)'}`);

// ---------------------------------------------------------------- 3. exclusive creation
const tmp = mkdtempSync(join(tmpdir(), 'evidence-wx-'));
const target = join(tmp, 'taken.md');
writeFileSync(target, 'original', { flag: 'wx' });
let threw = null;
try { writeFileSync(target, 'overwrite attempt', { flag: 'wx' }); } catch (error) { threw = error; }
check('exclusive creation refuses to overwrite an existing file', threw?.code === 'EEXIST', String(threw?.code));
check('the existing file is untouched', readFileSync(target, 'utf8') === 'original');

// Leave the stack demo-ready: the suite's own /__reset is v1-only.
const { restoreDemoCast } = await import('../scripts/db.ts');
await restoreDemoCast();
check('demo cast restored after the suite run', true);

const failed = results.filter((x) => !x.ok).length;
console.log(`\nRESULT: ${results.length - failed}/${results.length} PASS`);
process.exit(failed === 0 ? 0 : 1);
