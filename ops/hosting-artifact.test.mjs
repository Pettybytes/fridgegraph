/**
 * The composed supergraph is a BUILD PRODUCT. A committed copy goes stale while routers compose a fresh
 * one — that is exactly how the MCP came to load a schema without `proposeAddVillager`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

test('no composed artifact is tracked', () => {
  const tracked = execFileSync('git', ['ls-files', 'supergraph.graphql'], { encoding: 'utf8' }).trim();
  assert.equal(tracked, '', 'supergraph.graphql must not be committed — compose it into .runs/');
  assert.ok(!existsSync('supergraph.graphql'), 'a stale root artifact must not exist');
});

test('the MCP config points at the runtime artifact', () => {
  assert.match(read('.apollo/mcp.local.yaml'), /path:\s*\.\/\.runs\/supergraph\.graphql/);
});

test('alt-stack composes before it starts a router, and both consumers use .runs', () => {
  const sh = read('ops/alt-stack.sh');
  const composeAt = sh.indexOf('rover" supergraph compose');
  const routerAt = sh.indexOf('--supergraph "$ROOT/.runs/supergraph.graphql"');
  assert.ok(composeAt > -1, 'alt-stack must compose the artifact');
  assert.ok(routerAt > composeAt, 'composition must happen before the router starts');
  assert.match(sh, /--schema "\$ROOT\/\.runs\/supergraph\.graphql"/);
});

test('the demo login switch is stated, not implied', () => {
  const env = read('.env.example');
  assert.match(env, /^DEMO_LOGIN_ENABLED=1$/m);
  assert.match(env, /^DEMO_LOGIN_PORT=4008$/m);
  assert.match(env, /4008/);
});
