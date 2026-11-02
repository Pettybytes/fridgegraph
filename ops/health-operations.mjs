/**
 * MCP operation coverage — the check that would have caught a schema/registration drift.
 *
 * THE GAP THIS CLOSES
 * `stack-health` called `MyChildren` and reported the MCP healthy. It never asked whether the
 * operations the MCP is CONFIGURED with still exist in the schema the router actually serves. When
 * `proposeAddVillager` and `confirmAddVillager` shipped, health stayed green while the router exposed
 * neither, and a whole participant slot was spent discovering it.
 *
 * WHAT IT DOES
 * 1. reads the operation documents listed in the MCP config (`operations.paths`), so the check covers
 *    exactly what the MCP will try to run — not a directory glob that could drift from the config;
 * 2. introspects the served router schema;
 * 3. `validate()`s each document against it.
 *
 * NOTHING IS EXECUTED. No mutation is sent, no query runs — introspection plus static validation.
 * If the served schema cannot be obtained, that is a FAILURE with the reason stated, never a skip:
 * "I could not check" is not "it is fine".
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { buildClientSchema, getIntrospectionQuery, parse, validate } from 'graphql';

/** Operation paths listed under `operations.paths` in the MCP config (small, targeted reader). */
export function configuredOperationPaths(configPath) {
  const text = readFileSync(configPath, 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^operations:\s*$/.test(l));
  if (start === -1) throw new Error(`no operations: block in ${configPath}`);
  const paths = [];
  let inPaths = false;
  let baseIndent = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // left the operations block
    const indent = line.length - line.trimStart().length;
    if (/^\s*paths:\s*$/.test(line)) { inPaths = true; baseIndent = indent; continue; }
    if (inPaths) {
      const m = line.match(/^\s*-\s*(\S+)\s*$/);
      if (m) { paths.push(m[1]); continue; }
      if (line.trim() && indent <= baseIndent) inPaths = false;
    }
  }
  return paths.map((p) => p.replace(/^\.\//, ''));
}

/** Introspect the router. Returns {schema} or {reason} — never throws. */
export async function servedSchema(routerUrl, timeoutMs = 8000) {
  const url = routerUrl.replace(/\/$/, '') + '/';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: getIntrospectionQuery(), operationName: 'IntrospectionQuery' }),
      signal: controller.signal,
    });
    if (!res.ok) return { reason: `introspection returned HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (body?.errors?.length) return { reason: `introspection errored: ${body.errors[0].message}` };
    if (!body?.data?.__schema) return { reason: 'no __schema in the introspection response' };
    return { schema: buildClientSchema(body.data) };
  } catch (e) {
    return { reason: `introspection unavailable: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate every configured document. Returns a shape that a health check can assert on:
 *   { schemaOk, schemaReason, checked, failures: [{ file, message }] }
 */
export async function validateConfiguredOperations({ configPath, routerUrl, root = process.cwd() }) {
  const paths = configuredOperationPaths(configPath);
  const { schema, reason } = await servedSchema(routerUrl);
  if (!schema) {
    return { schemaOk: false, schemaReason: reason, checked: 0, failures: [], paths };
  }

  const failures = [];
  for (const file of paths) {
    let document;
    try {
      const full = isAbsolute(file) ? file : join(root, file);
      document = parse(readFileSync(full, 'utf8'));
    } catch (e) {
      failures.push({ file, message: `syntax: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const errors = validate(schema, document);
    if (errors.length) failures.push({ file, message: errors[0].message });
  }
  return { schemaOk: true, schemaReason: null, checked: paths.length, failures, paths };
}
