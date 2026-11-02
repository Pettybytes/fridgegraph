/**
 * MCP schema selection — the check that would have caught `ERROR field proposeAddVillager not found`.
 *
 * Offline: no router, no MCP server, no database. The generator guard and the checker's verdict are
 * both arithmetic over local files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'fg-mcp-'));
const schemaPath = join(dir, 'schema.graphql');
writeFileSync(schemaPath, 'type Query { hello: String }\ntype Mutation { ping: String }\n');

const configPath = join(dir, 'mcp.yaml');
writeFileSync(configPath, [
  'endpoint: http://127.0.0.1:4010/',
  'transport:',
  '  type: streamable_http',
  '  address: 127.0.0.1',
  '  port: 5050',
  'schema:',
  '  source: local',
  '  path: ./supergraph.graphql',
  'operations:',
  '  source: local',
  '  paths:',
  '    - ./ops/One.graphql',
  'forward_headers:',
  '  - authorization',
  'overrides:',
  '  mutation_mode: explicit',
].join('\n'));
mkdirSync(join(dir, 'ops'), { recursive: true });
const opOne = join(dir, 'ops', 'One.graphql');
writeFileSync(opOne, '{ hello }\n');

const run = (args) => {
  try {
    const stdout = execFileSync(process.execPath, ['ops/gen-mcp-config.mjs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
};

test('the generator refuses a schema that lacks a field the operations need', () => {
  const out = join(dir, 'generated.yaml');
  const r = run(['--out', out, '--src', configPath, '--schema', schemaPath, '--expect-fields', 'proposeAddVillager']);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /missing expected field\(s\): proposeAddVillager/);
});

test('the generator records WHICH schema it selected, with its hash', () => {
  const out = join(dir, 'generated2.yaml');
  const r = run(['--out', out, '--src', configPath, '--root', dir, '--schema', schemaPath, '--expect-fields', 'ping']);
  assert.equal(r.code, 0, r.stderr);
  const text = readFileSync(out, 'utf8');
  assert.match(text, /# mcp_schema_path: /);
  assert.match(text, /# mcp_schema_sha256: [0-9a-f]{64}/);
  assert.match(text, new RegExp(`path: ${schemaPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('the checker fails a document absent from the MCP schema, and keeps router validity separate', () => {
  // An operation the local schema does NOT have. Router is unreachable on purpose: the MCP verdict must
  // stand on its own, and router validity must read UNKNOWN rather than silently passing.
  const opTwo = join(dir, 'ops', 'Two.graphql');
  writeFileSync(opTwo, 'mutation { proposeAddVillager { id } }\n');
  const cfg = join(dir, 'mcp2.yaml');
  writeFileSync(cfg, readFileSync(configPath, 'utf8').replace('./ops/One.graphql', './ops/Two.graphql'));
  let code = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, ['ops/mcp-schema-check.mjs', '--config', cfg, '--router', 'http://127.0.0.1:1/'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    code = e.status ?? 1;
    stdout = String(e.stdout ?? '');
  }
  // The config's schema.path points at ./supergraph.graphql which does not exist under `dir`, so the
  // checker must refuse loudly rather than pass.
  assert.notEqual(code, 0);
  assert.match(stdout + '', /BLOCKED|not in the MCP schema|FAILED/);
});
