/**
 * Health operation coverage — the check must FAIL when it cannot see the schema, and must catch a
 * document that the served schema does not actually support. Both are tested against a fake router,
 * so no real stack is required and nothing is executed against production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSchema, introspectionFromSchema } from 'graphql';
import { configuredOperationPaths, servedSchema, validateConfiguredOperations } from './health-operations.mjs';

const dir = mkdtempSync(join(tmpdir(), 'fg-health-'));
const config = join(dir, 'mcp.yaml');
writeFileSync(config, [
  'endpoint: http://127.0.0.1:4010/',
  'operations:',
  '  source: local',
  '  paths:',
  '    - ./One.graphql',
  '    - ./Two.graphql',
  'schema:',
  '  source: local',
  '  paths:',
  '    - ./schema/x.graphql',
].join('\n'));
writeFileSync(join(dir, 'One.graphql'), 'query { hello }\n');
writeFileSync(join(dir, 'Two.graphql'), 'query { missingField }\n');

const schema = buildSchema('type Query { hello: String }');
const introspection = introspectionFromSchema(schema);

const listen = async (handler) => {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
};

test('configured operation paths are read from the config, not a directory glob', () => {
  const paths = configuredOperationPaths(config);
  assert.deepEqual(paths, ['One.graphql', 'Two.graphql']);
});

test('a document the served schema does not support is reported as a failure', async () => {
  const { server, url } = await listen((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: introspection }));
  });
  try {
    const result = await validateConfiguredOperations({ configPath: config, routerUrl: url, root: dir });
    assert.equal(result.schemaOk, true);
    assert.equal(result.checked, 2);
    assert.equal(result.failures.length, 1, JSON.stringify(result.failures));
    assert.match(result.failures[0].file, /Two\.graphql$/);
  } finally {
    server.close();
  }
});

test('an all-valid set passes', async () => {
  writeFileSync(join(dir, 'Two.graphql'), 'query { hello }\n');
  const { server, url } = await listen((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: introspection }));
  });
  try {
    const result = await validateConfiguredOperations({ configPath: config, routerUrl: url, root: dir });
    assert.equal(result.schemaOk, true);
    assert.equal(result.failures.length, 0);
  } finally {
    server.close();
  }
});

test('an unobtainable schema is an explicit failure, never a silent pass', async () => {
  const result = await validateConfiguredOperations({ configPath: config, routerUrl: 'http://127.0.0.1:1/', root: dir });
  assert.equal(result.schemaOk, false);
  assert.equal(result.checked, 0);
  assert.match(String(result.schemaReason), /introspection (returned|unavailable|errored)/);
});

test('the router answering without __schema is also a failure', async () => {
  const { server, url } = await listen((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: null }));
  });
  try {
    const direct = await servedSchema(url);
    assert.equal(direct.schema, undefined);
    assert.match(String(direct.reason), /no __schema/);
  } finally {
    server.close();
  }
});
