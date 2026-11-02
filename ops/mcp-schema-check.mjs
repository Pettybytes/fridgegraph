#!/usr/bin/env node
/**
 * mcp-schema-check — does the MCP's SELECTED schema actually support the operations it is configured with?
 *
 * THE INCIDENT (2026-11-02, main e99be47)
 * `.apollo/mcp.local.yaml` selected `./supergraph.graphql`. The generator rebased that to
 * `<repo>/supergraph.graphql` — a COMMITTED artifact whose sha256 was `0905802b…` and which contained
 * neither `proposeAddVillager` nor `villageWorld`. Routers were serving a freshly composed artifact
 * (`93506905…`). The MCP therefore logged `ERROR field proposeAddVillager not found` while still listing
 * `Tool ProposeAddVillager loaded` — it had a tool whose field did not exist in the schema it loaded.
 *
 * WHAT THIS CHECKS — two different questions, kept apart
 *   1. MCP schema validity: each configured document validates against the schema file the MCP loads.
 *   2. Router API validity: the same documents validate against the router's live schema.
 * A document can be (1) yes (2) yes and still not execute, so `routable` is reported as UNKNOWN here —
 * proving routability requires executing, which this tool never does.
 *
 * Usage: node ops/mcp-schema-check.mjs [--config .apollo/mcp.local.yaml] [--router http://127.0.0.1:4012/]
 * Exit: 0 both valid · 1 a document fails either side · 2 the MCP schema could not be read
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { buildClientSchema, buildSchema, getIntrospectionQuery, parse, validate } from 'graphql';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const CONFIG = arg('config', '.apollo/mcp.local.yaml');
const ROUTER = arg('router', 'http://127.0.0.1:4012/').replace(/\/$/, '') + '/';

/** Small targeted reader: the `schema.path` and `operations.paths` of the MCP config. */
function readConfig(configPath) {
  const text = readFileSync(configPath, 'utf8');
  const lines = text.split('\n');
  const schemaLine = lines.find((l) => /^\s*path:\s*\S+\.graphql\s*$/.test(l));
  const schemaRel = schemaLine ? schemaLine.split(':').slice(1).join(':').trim() : null;
  const paths = [];
  let inOps = false;
  for (const line of lines) {
    if (/^operations:\s*$/.test(line)) { inOps = true; continue; }
    if (inOps && /^\S/.test(line)) break;
    const m = line.match(/^\s*-\s*(\S+\.graphql)\s*$/);
    if (m) paths.push(m[1]);
  }
  return { schemaRel, paths };
}

const { schemaRel, paths } = readConfig(CONFIG);
if (!schemaRel) { console.log('BLOCKED: the config names no schema.path'); process.exit(2); }

const root = process.cwd();
const schemaPath = isAbsolute(schemaRel) ? schemaRel : resolve(root, schemaRel.replace(/^\.\//, ''));
if (!existsSync(schemaPath)) { console.log(`BLOCKED: schema file not found: ${schemaPath}`); process.exit(2); }

const schemaText = readFileSync(schemaPath, 'utf8');
const schemaSha = createHash('sha256').update(schemaText).digest('hex');
console.log(`MCP schema: ${schemaPath}\n  sha256 ${schemaSha}`);

let mcpSchema;
try {
  mcpSchema = schemaText.trimStart().startsWith('{')
    ? buildClientSchema(JSON.parse(schemaText))   // introspection JSON
    : buildSchema(schemaText);                    // SDL
} catch (e) {
  console.log(`BLOCKED: cannot build the MCP schema — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

let routerSchema = null;
let routerReason = null;
try {
  const res = await fetch(ROUTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: getIntrospectionQuery(), operationName: 'IntrospectionQuery' }),
  });
  const body = await res.json().catch(() => null);
  if (body?.data?.__schema) routerSchema = buildClientSchema(body.data);
  else routerReason = body?.errors?.[0]?.message ?? `HTTP ${res.status}`;
} catch (e) {
  routerReason = e instanceof Error ? e.message : String(e);
}

let mcpBad = 0;
let routerBad = 0;
console.log(`\n${paths.length} configured operation document(s)\n`);
for (const rel of paths) {
  const file = isAbsolute(rel) ? rel : join(root, rel);
  let doc;
  try { doc = parse(readFileSync(file, 'utf8')); }
  catch (e) { console.log(`  FAIL  ${rel} — syntax: ${e instanceof Error ? e.message : String(e)}`); mcpBad += 1; routerBad += 1; continue; }
  const mcpErrors = validate(mcpSchema, doc);
  const routerErrors = routerSchema ? validate(routerSchema, doc) : [];
  if (mcpErrors.length) mcpBad += 1;
  if (routerErrors.length) routerBad += 1;
  if (!mcpErrors.length && !routerErrors.length) { console.log(`  PASS  ${rel}`); continue; }
  if (mcpErrors.length) console.log(`  FAIL  ${rel} — not in the MCP schema: ${mcpErrors[0].message}`);
  else console.log(`  FAIL  ${rel} — not in the router schema: ${routerErrors[0].message}`);
}

const verdict = mcpBad === 0 && routerBad === 0;
console.log(`\nMCP schema validity: ${mcpBad ? `${mcpBad} invalid` : 'valid'}`);
console.log(`Router API validity: ${routerSchema ? (routerBad ? `${routerBad} invalid` : 'valid') : `UNKNOWN (${routerReason ?? 'router unreachable'})`}`);
console.log('Runtime routability: UNKNOWN — this check never executes an operation.');
console.log(verdict ? 'MCP SCHEMA CHECK PASS' : 'MCP SCHEMA CHECK FAILED');
process.exit(verdict ? 0 : 1);
