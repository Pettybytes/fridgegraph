/**
 * Pins the 2026-11-02 MCP incident: a generated config without `forward_headers` made every tool
 * return UNAUTHENTICATED for a valid bearer, and a 200-with-a-payload check called it healthy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate, topLevelKeys, SRC_DEFAULT } from './gen-mcp-config.mjs';

const src = readFileSync(SRC_DEFAULT, 'utf8');
// The real repo root: the generator refuses operation paths that do not exist, which is a
// property worth keeping, so the test must point at files that are actually there.
const opts = { root: process.cwd(), endpoint: 'http://127.0.0.1:4012/', port: 5051 };

test('the generated config keeps forward_headers: authorization', () => {
  const { text } = generate(src, opts);
  assert.match(text, /^forward_headers:\s*\n\s*-\s*authorization\s*$/m);
});

test('the generated config keeps every top-level key from the committed file', () => {
  const { keys } = generate(src, opts);
  const after = new Set(topLevelKeys(generate(src, opts).text));
  const missing = keys.filter((k) => !after.has(k));
  assert.deepEqual(missing, []);
  assert.ok(keys.includes('forward_headers'));
  assert.ok(keys.includes('operations'));
});

test('endpoint and port are rebased, operation paths are absolute', () => {
  const { text, operations } = generate(src, opts);
  assert.match(text, /^endpoint: http:\/\/127\.0\.0\.1:4012\/$/m);
  assert.match(text, /^\s*port: 5051$/m);
  assert.match(text, new RegExp(`^\\s*-\\s+${process.cwd().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/ops/[^\\s]+\\.graphql$`, 'm'));
  assert.ok(operations >= 11, `expected the operation files to be preserved, got ${operations}`);
});

test('a source without forward_headers is refused, not silently generated', () => {
  const broken = src.replace(/^forward_headers:\s*\n\s*-\s*authorization\s*\n/m, '');
  assert.throws(() => generate(broken, opts), /forward_headers must list authorization/);
});

test('a source without explicit mutation_mode is refused', () => {
  const broken = src.replace(/^overrides:\s*\n\s+mutation_mode:\s*explicit\s*$/m, '');
  assert.throws(() => generate(broken, opts), /mutation_mode must be explicit/);
});
