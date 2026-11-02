#!/usr/bin/env node
/**
 * Generate a runtime MCP config FROM the committed `.apollo/mcp.local.yaml`.
 *
 * WHY THIS EXISTS (2026-11-02 incident)
 * A window-time config was hand-assembled from memory of the committed file. It omitted
 * `forward_headers: [authorization]`, so the MCP server never passed the caller's bearer downstream:
 * every tool returned `UNAUTHENTICATED` for a valid session, and every Rosina turn failed closed.
 * A "200 with a payload" check did not catch it because the payload *was* an error.
 *
 * THE RULE
 * The committed file is the source of truth. This generator rewrites ONLY the endpoint, the port,
 * the schema path and the operation paths, then parses both files and REFUSES to write if any
 * top-level key from the committed file is missing — and specifically if `forward_headers` does not
 * carry `authorization` or `mutation_mode` is not `explicit`.
 *
 * Usage:
 *   node ops/gen-mcp-config.mjs --out /tmp/mcp.yaml --root . --endpoint http://127.0.0.1:4010/ --port 5051
 *   node ops/gen-mcp-config.mjs --out … --self-check     (validate the committed file only)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SRC_DEFAULT = '.apollo/mcp.local.yaml';

/** Top-level YAML keys, in order, ignoring comments and indented lines. */
export function topLevelKeys(text) {
  const keys = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#') || /^\s/.test(line)) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

export function generate(srcText, { root, endpoint, port }) {
  const keys = topLevelKeys(srcText);
  if (!keys.length) throw new Error('source config has no top-level keys; refusing');

  let out = srcText;
  if (endpoint) {
    out = out.replace(/^endpoint:\s*\S+\s*$/m, `endpoint: ${endpoint}`);
    if (!new RegExp(`^endpoint:\\s*${endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(out)) {
      throw new Error('could not rebase the endpoint; the source shape changed');
    }
  }
  if (port) {
    out = out.replace(/^(\s*)port:\s*\d+\s*$/m, `$1port: ${port}`);
    if (!new RegExp(`^\\s*port:\\s*${port}\\s*$`, 'm').test(out)) {
      throw new Error('could not rebase the transport port; the source shape changed');
    }
  }
  if (root) {
    out = out
      .replace(/^(\s*)path:\s*\.\/supergraph\.graphql\s*$/m, `$1path: ${root}/supergraph.graphql`)
      .replace(/^(\s*-\s+)\.\/ops\/([^\s]+\.graphql)\s*$/gm, `$1${root}/ops/$2`);
  }

  // Key parity. This is the check that would have caught the missing forward_headers.
  const after = new Set(topLevelKeys(out));
  const missing = keys.filter((k) => !after.has(k));
  if (missing.length) throw new Error(`generated config dropped top-level key(s): ${missing.join(', ')}`);

  // Named keys whose VALUE carries the behaviour. A key that survives with the wrong content is no better.
  const fh = out.match(/^forward_headers:\s*\n((?:\s+- .*\n)+)/m);
  if (!fh || !/^\s*-\s*authorization\s*$/m.test(fh[1])) {
    throw new Error('forward_headers must list authorization; without it every tool is UNAUTHENTICATED');
  }
  if (!/^overrides:\s*\n\s+mutation_mode:\s*explicit\s*$/m.test(out)) {
    throw new Error('mutation_mode must be explicit; otherwise mutation tools are skipped silently');
  }

  const ops = [...out.matchAll(/^\s*-\s*(\S+\.graphql)\s*$/gm)].map((m) => m[1]);
  const missingFiles = [...ops, ...(out.match(/^\s*path:\s*(\S+)$/gm) ?? []).map((l) => l.split(':').slice(1).join(':').trim())]
    .filter((p) => p.startsWith('/') && !existsSync(p));
  if (missingFiles.length) throw new Error(`generated config refers to missing file(s): ${missingFiles.join(', ')}`);

  return { text: out, keys, operations: ops.length };
}

function args() {
  const a = process.argv.slice(2);
  const get = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
  return { out: get('out', null), root: get('root', process.cwd()), endpoint: get('endpoint', null), port: get('port', null), src: get('src', SRC_DEFAULT), selfCheck: a.includes('--self-check') };
}

async function main() {
  const { out, root, endpoint, port, src, selfCheck } = args();
  const srcText = readFileSync(src, 'utf8');
  const result = generate(srcText, { root, endpoint, port });
  if (selfCheck) {
    console.log(`MCP CONFIG SELF-CHECK PASS — ${result.keys.length} top-level keys, ${result.operations} operation(s), forward_headers=authorization, mutation_mode=explicit`);
    return;
  }
  if (!out) { console.error('REFUSED: --out is required unless --self-check'); process.exit(2); }
  writeFileSync(out, result.text, { mode: 0o600 });
  console.log(`mcp config -> ${out} (${result.keys.length} keys, ${result.operations} operations, forward_headers=authorization)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(`REFUSED: ${e.message}`); process.exit(1); });
}
