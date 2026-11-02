/**
 * MCP schema selection + combined check — isolated regressions, no shared stack.
 *
 * The children are spawned ASYNCHRONOUSLY on purpose. The mock router lives in this process, so a
 * synchronous exec would block the event loop that has to answer the child's introspection fetch —
 * a deadlock that looks exactly like a hung test run.
 *
 *   1. generating WITHOUT --schema refuses and writes no config;
 *   2. a valid local schema + unreachable router exits NON-ZERO (no [] substitute counted as success);
 *   3. valid schemas on both sides PASS, against a local mock router;
 *   4. a field absent from EITHER schema fails;
 *   5. --self-check is non-generating and claims no deployment-schema validity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSchema, introspectionFromSchema } from 'graphql';

const exec = promisify(execFile);
const root = mkdtempSync(join(tmpdir(), 'fg-mcp-'));
mkdirSync(join(root, 'ops'), { recursive: true });

const localSchema = join(root, 'schema.graphql');
writeFileSync(localSchema, 'type Query { hello: String  extra: String }\n');
const opHello = join(root, 'ops', 'Hello.graphql');
writeFileSync(opHello, '{ hello }\n');
const opExtra = join(root, 'ops', 'Extra.graphql');
writeFileSync(opExtra, '{ extra }\n');
const opMissing = join(root, 'ops', 'Missing.graphql');
writeFileSync(opMissing, '{ missingField }\n');

function writeConfig(name, ops, schemaPath = localSchema) {
  const p = join(root, name);
  writeFileSync(p, [
    'endpoint: http://127.0.0.1:4010/',
    'transport:',
    '  type: streamable_http',
    '  address: 127.0.0.1',
    '  port: 5050',
    'schema:',
    '  source: local',
    `  path: ${schemaPath}`,
    'operations:',
    '  source: local',
    '  paths:',
    ...ops.map((o) => `    - ${o}`),
    'forward_headers:',
    '  - authorization',
    'overrides:',
    '  mutation_mode: explicit',
  ].join('\n'));
  return p;
}

async function run(bin, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], { encoding: 'utf8' });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}
const gen = (args) => run('ops/gen-mcp-config.mjs', args);
const check = (args) => run('ops/mcp-schema-check.mjs', args);

/** Serve an introspection response for the given SDL; returns {url, close}. */
async function mockRouter(sdl) {
  const introspection = introspectionFromSchema(buildSchema(sdl));
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: introspection }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

test('1. generation without --schema refuses and writes no config', async () => {
  const out = join(root, 'never-written.yaml');
  const cfg = writeConfig('mcp-base.yaml', [opHello]);
  const r = await gen(['--out', out, '--src', cfg, '--root', root]);
  assert.notEqual(r.code, 0, 'must refuse');
  assert.match(r.stderr, /--schema/);
  assert.equal(existsSync(out), false, 'no config may be written');
});

test('2. valid local schema + unreachable router exits non-zero', async () => {
  const cfg = writeConfig('mcp-hello.yaml', [opHello]);
  const r = await check(['--config', cfg, '--router', 'http://127.0.0.1:1/']);
  assert.notEqual(r.code, 0, 'an unobtainable router schema must not pass');
  assert.match(r.stdout, /MCP schema validity: valid/);
  assert.match(r.stdout, /Router API validity: UNKNOWN/);
  assert.match(r.stdout, /INCOMPLETE/);
});

test('3. valid schemas on both sides pass, using a local mock router', async () => {
  const mock = await mockRouter('type Query { hello: String }');
  try {
    const cfg = writeConfig('mcp-hello2.yaml', [opHello]);
    const r = await check(['--config', cfg, '--router', mock.url]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /MCP SCHEMA CHECK PASS/);
    assert.match(r.stdout, /Runtime routability: UNKNOWN/);
  } finally {
    mock.close();
  }
});

test('4a. a field absent from the MCP schema fails', async () => {
  const mock = await mockRouter('type Query { hello: String }');
  try {
    const cfg = writeConfig('mcp-missing.yaml', [opMissing]);
    const r = await check(['--config', cfg, '--router', mock.url]);
    assert.notEqual(r.code, 0);
    assert.match(r.stdout, /not in the MCP schema/);
  } finally {
    mock.close();
  }
});

test('4b. a field absent from the ROUTER schema fails even when the MCP schema has it', async () => {
  const mock = await mockRouter('type Query { hello: String }'); // no `extra`
  try {
    const cfg = writeConfig('mcp-extra.yaml', [opExtra]);
    const r = await check(['--config', cfg, '--router', mock.url]);
    assert.notEqual(r.code, 0);
    assert.match(r.stdout, /not in the router schema/);
    assert.match(r.stdout, /MCP schema validity: valid/);
  } finally {
    mock.close();
  }
});

test('5. --self-check is non-generating and claims no deployment-schema validity', async () => {
  const r = await gen(['--self-check']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /SELF-CHECK PASS \(source file only\)/);
  assert.match(r.stdout, /does NOT validate any deployment schema artifact/);
});
