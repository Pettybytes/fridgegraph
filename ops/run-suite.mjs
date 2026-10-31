#!/usr/bin/env node
/**
 * ops/run-suite.mjs — run the evidence suite, then ALWAYS restore the demo cast.
 *
 * THE DEFECT THIS WRAPS: `resetDatabase()` (the suite's /__reset) is the v1 baseline reset. Cast v2 is
 * seeded and then deleted again by that reset for every table in RESET_SCOPED, because its `keep` set
 * is the v1 baseline ids. The cast is demo CONTENT, not test junk.
 *
 * `resetDatabase()` is deliberately NOT changed here: its baseline reset/checksum contract is
 * published and must stay exactly as it is. Instead the restore is additive and runs in a `finally`,
 * so a failing, crashing or interrupted suite still leaves the stack demo-ready.
 *
 * Usage:
 *   node --import tsx ops/run-suite.mjs               # normal run
 *   node --import tsx ops/run-suite.mjs --force-fail  # every case fails (router pointed at a dead port)
 *
 * Exit code is the suite's (or 1 for --force-fail), so this is a drop-in replacement.
 */
import { spawn } from 'node:child_process';

const forceFail = process.argv.includes('--force-fail');

const env = { ...process.env };
if (forceFail) {
  // A dead router: every case fails, the suite still reaches its reset step, and the trap must still
  // put the cast back. This is the "restoration runs even when the suite fails" proof.
  env.FRIDGEGRAPH_ROUTER = 'http://127.0.0.1:9/';
}

let restored = false;
const restore = async (why) => {
  if (restored) return;
  restored = true;
  // Imported lazily so a wrapper that is only inspected never opens a connection.
  const { restoreDemoCast } = await import('../scripts/db.ts');
  try {
    const out = await restoreDemoCast();
    console.log(`[suite] demo cast restored (${why}): cast=${out.cast} rows, simulated=${JSON.stringify(out.simulated)}`);
  } catch (error) {
    console.error(`[suite] DEMO CAST RESTORE FAILED (${why}): ${error instanceof Error ? error.message : 'unknown'}`);
    process.exitCode = 2;
  }
};

const child = spawn(process.execPath, ['--import', 'tsx', 'ops/run-evidence.mjs'], {
  stdio: 'inherit',
  env,
});

const code = await new Promise((resolve) => {
  child.on('exit', (c, signal) => resolve(signal ? 1 : (c ?? 1)));
  child.on('error', () => resolve(1));
});

// The trap. Runs for a pass, a failure, or a crash of the child.
await restore(code === 0 ? 'suite passed' : `suite failed (exit ${code})`);

if (forceFail) {
  console.log('[suite] --force-fail: reporting failure as requested after restoring');
  process.exit(1);
}
process.exit(process.exitCode === 2 ? 2 : code);
