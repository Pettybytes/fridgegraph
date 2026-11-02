/**
 * The launcher's contract, asserted without starting anything.
 *
 * `--dry-run` exists because the honest proof of a launcher is not "it printed a plan" but "it refuses
 * to touch a stack it did not start, and it names every component it would start". The shared stack is
 * running during development, so a dry run against those ports MUST report blockers rather than pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';

const exec = promisify(execFile);

const runLauncher = async (args, env = {}) => {
  try {
    const { stdout, stderr } = await exec('bash', ['ops/alt-stack.sh', ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
};

test('dry run names every component including Rosina and the demo-login switch', async () => {
  const r = await runLauncher(['--dry-run'], { ALT_STACK_SUFFIX: '.test' });
  const out = r.stdout;
  assert.match(out, /PLAN \(dry run — nothing will be started\)/);
  assert.match(out, /subgraphs\s+4101-4107/);
  assert.match(out, /router\s+4012/);
  assert.match(out, /mcp\s+5051/);
  assert.match(out, /rosina\s+4200.*ROSINA_MCP_URL=http:\/\/127\.0\.0\.1:5051\/mcp/);
  assert.match(out, /ROSINA_GRAPHQL_URL=http:\/\/127\.0\.0\.1:4012\//);
  assert.match(out, /demo login 4108\s+DEMO_LOGIN_ENABLED=1/);
});

test('dry run states what it will NOT do — no reset, seed, migrations or tunnel', async () => {
  const r = await runLauncher(['--dry-run'], { ALT_STACK_SUFFIX: '.test' });
  assert.match(r.stdout, /does NOT run: reset, seed, migrations, tunnel/);
});

test('dry run is either OK or BLOCKED, never a silent success, and starts nothing', async () => {
  const pidfileBefore = existsSync('.alt-stack.test.pids');
  const r = await runLauncher(['--dry-run'], { ALT_STACK_SUFFIX: '.test' });
  assert.ok([0, 3].includes(r.code), `unexpected exit ${r.code}`);
  assert.match(r.stdout, /PLAN OK|PLAN BLOCKED/);
  assert.equal(existsSync('.alt-stack.test.pids'), pidfileBefore, 'a dry run must not create a pidfile');
});

test('the verdict is consistent: BLOCKED iff blockers, OK iff none', async () => {
  // A CI runner has no rover/MCP binaries and no listening stack; a dev machine has both and a live
  // stack. The invariant that must hold everywhere is the correspondence, not which blockers appear.
  const r = await runLauncher(['--dry-run'], { ALT_STACK_SUFFIX: '.test' });
  const blocked = /PLAN BLOCKED/.test(r.stdout);
  const ok = /PLAN OK/.test(r.stdout);
  assert.ok(blocked !== ok, 'exactly one verdict must be printed');
  if (blocked) {
    assert.equal(r.code, 3);
    assert.match(r.stdout, /BLOCKER /);
  } else {
    assert.equal(r.code, 0);
  }
});

test('--up refuses when a pidfile already exists, before starting anything', async () => {
  const suffix = '.refusal';
  const pidfile = `.alt-stack${suffix}.pids`;
  const { writeFileSync, rmSync } = await import('node:fs');
  writeFileSync(pidfile, '');
  try {
    const r = await runLauncher(['--up'], { ALT_STACK_SUFFIX: suffix });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr + r.stdout, /may already be up/);
  } finally {
    rmSync(pidfile, { force: true });
  }
});

test('the launcher does not run destructive steps anywhere in its start path', () => {
  const sh = readFileSync('ops/alt-stack.sh', 'utf8');
  for (const forbidden of ['db:reset', 'db:seed', 'psql', 'cloudflared', 'migrate']) {
    assert.ok(!new RegExp(`^[^#]*${forbidden}`, 'm').test(sh), `start path must not invoke ${forbidden}`);
  }
});
