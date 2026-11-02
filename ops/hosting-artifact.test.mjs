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

test('alt-stack composes OFFLINE before it starts a router, and both consumers use .runs', () => {
  const sh = read('ops/alt-stack.sh');
  // The entry point moved to ops/compose-offline.mjs (#132): composing from supergraph.yaml required
  // another running checkout and baked that stack's routing URLs into the artifact.
  const composeAt = sh.indexOf('ops/compose-offline.mjs');
  const routerAt = sh.indexOf('--supergraph "$ROOT/.runs/supergraph.graphql"');
  assert.ok(composeAt > -1, 'alt-stack must compose via ops/compose-offline.mjs');
  assert.ok(routerAt > composeAt, 'composition must happen before the router starts');
  assert.ok(sh.includes('--base-port "$SUBGRAPH_BASE"'), 'offline composition must target this stack\'s ports');
  assert.ok(!/rover" supergraph compose/.test(sh), 'composing from supergraph.yaml reintroduces the other-checkout dependency');
  assert.match(sh, /--schema "\$ROOT\/\.runs\/supergraph\.graphql"/);
});

test('the demo login switch is stated, not implied', () => {
  const env = read('.env.example');
  assert.match(env, /^DEMO_LOGIN_ENABLED=1$/m);
  assert.match(env, /^DEMO_LOGIN_PORT=4008$/m);
  assert.match(env, /4008/);
});

test('the REAL committed config generates against an explicit artifact (path + sha256 header)', async () => {
  // The earlier generator matched one literal filename, so every real generation threw once the config
  // named ./.runs/supergraph.graphql. Temp-config tests could not see it; this runs the committed file.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const exec = promisify(execFile);

  const dir = mkdtempSync(join(tmpdir(), 'fg-real-'));
  const artifact = join(dir, 'supergraph.graphql');
  const sdl = 'type Query { villageWorld: String }\ntype Mutation { proposeAddVillager: String }\n';
  writeFileSync(artifact, sdl);
  const out = join(dir, 'mcp.yaml');

  const { stdout } = await exec(process.execPath, [
    'ops/gen-mcp-config.mjs',
    '--out', out,
    '--src', '.apollo/mcp.local.yaml',
    '--schema', artifact,
    '--expect-fields', 'villageWorld,proposeAddVillager',
  ], { encoding: 'utf8' });

  const generated = readFileSync(out, 'utf8');
  const sha = createHash('sha256').update(sdl).digest('hex');
  assert.match(stdout, /mcp schema -> /);
  assert.ok(generated.startsWith(`# mcp_schema_path: ${artifact}`), 'header must record the artifact path');
  assert.match(generated, new RegExp(`# mcp_schema_sha256: ${sha}`));
  assert.match(generated, new RegExp(`path: ${artifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  // The rest of the committed config survives the rebase.
  assert.match(generated, /^operations:$/m);
  assert.match(generated, /^forward_headers:$/m);
  assert.match(generated, /mutation_mode: explicit/);
});
