/**
 * The launcher composes from COMMITTED SDL — never from a running checkout.
 *
 * `supergraph.yaml` points every subgraph at `subgraph_url: http://127.0.0.1:4001..4007/`, so composing
 * from it required another stack to be up and baked that stack's routing URLs into the artifact.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

const exec = promisify(execFile);
const run = async (args) => {
  try {
    const { stdout } = await exec(process.execPath, ['ops/compose-offline.mjs', ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.code ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
};

test('routing URLs follow the requested base port, one per subgraph, in order', async () => {
  const r = await run(['--base-port', '4300', '--print-config']);
  assert.equal(r.code, 0, r.stderr);
  const names = ['village', 'access', 'coordination', 'schedule', 'school', 'transport', 'activities'];
  names.forEach((name, i) => {
    assert.match(r.stdout, new RegExp(`\\n  ${name}:\\n    routing_url: http://127\\.0\\.0\\.1:${4300 + i}/`));
  });
});

test('the schema source is a committed file, never a subgraph_url', async () => {
  const cfg = (await run(['--base-port', '4300', '--print-config'])).stdout;
  assert.match(cfg, /schema\/village\.graphql/);
  assert.ok(!/subgraph_url/.test(cfg), 'offline composition must not point at a running subgraph');
});

test('it refuses when committed SDL is missing rather than composing a partial graph', async () => {
  const r = await run(['--schema-dir', '/nonexistent-schema-dir', '--print-config']);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /REFUSED: committed SDL missing/);
});

test('alt-stack composes offline and no longer shells out to rover with supergraph.yaml', () => {
  const sh = readFileSync('ops/alt-stack.sh', 'utf8');
  assert.match(sh, /ops\/compose-offline\.mjs/);
  assert.ok(!/rover" supergraph compose --config "\$ROOT\/supergraph\.yaml"/.test(sh),
    'composing from supergraph.yaml reintroduces the dependency on another running checkout');
  const composeAt = sh.indexOf('compose-offline.mjs');
  const routerAt = sh.indexOf('--supergraph "$ROOT/.runs/supergraph.graphql"');
  assert.ok(composeAt > -1 && routerAt > composeAt, 'composition must precede the router start');
});

test('refusal to take over foreign processes is preserved', () => {
  const sh = readFileSync('ops/alt-stack.sh', 'utf8');
  assert.match(sh, /already listening|refus|REFUS/i);
});
