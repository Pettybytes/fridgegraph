#!/usr/bin/env node
/**
 * Validate operation documents against the SERVED router schema — without executing a single one.
 *
 * Why this exists: the previous health run reported the villager operations as healthy while the
 * router did not expose them at all, because health only checked documents it happened to know about
 * and never asked the router what it actually serves. Introspection + `validate()` is the cheap,
 * side-effect-free check that would have caught it.
 *
 * Usage: node ops/validate-operations.mjs [--router http://127.0.0.1:4012/] [--dir ops]
 * Exit: 0 all valid · 1 at least one invalid · 2 the served schema could not be obtained
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildClientSchema, getIntrospectionQuery, parse, validate } from 'graphql';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ROUTER = arg('router', 'http://127.0.0.1:4012/').replace(/\/$/, '') + '/';
const DIR = arg('dir', 'ops');

const fail = (code, message) => { console.log(`BLOCKED: ${message}`); process.exit(code); };

let schema;
try {
  const res = await fetch(ROUTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: getIntrospectionQuery(), operationName: 'IntrospectionQuery' }),
  });
  if (!res.ok) fail(2, `introspection returned HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  if (body?.errors?.length) fail(2, `introspection errored: ${body.errors[0].message}`);
  const introspection = body?.data;
  if (!introspection?.__schema) fail(2, 'no __schema in the response — cannot validate anything');
  schema = buildClientSchema(introspection);
} catch (e) {
  fail(2, `introspection unavailable: ${e instanceof Error ? e.message : String(e)}`);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.graphql')).sort();
let invalid = 0;
let checked = 0;

for (const file of files) {
  const source = readFileSync(join(DIR, file), 'utf8');
  let document;
  try {
    document = parse(source);
  } catch (e) {
    invalid += 1;
    console.log(`  FAIL  ${file} — syntax: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  const errors = validate(schema, document);
  checked += 1;
  if (errors.length) {
    invalid += 1;
    console.log(`  FAIL  ${file} — ${errors.length} schema error(s)`);
    for (const err of errors.slice(0, 4)) console.log(`         ${err.message}`);
  } else {
    console.log(`  PASS  ${file}`);
  }
}

console.log(`\n${checked} document(s) validated against ${ROUTER} · ${invalid} invalid`);
console.log(invalid ? 'OPERATIONS INVALID' : 'OPERATIONS VALID (nothing executed)');
process.exit(invalid ? 1 : 0);
