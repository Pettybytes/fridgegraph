#!/usr/bin/env node
/**
 * The committed subgraph SDL is GENERATED from `src/subgraphs/*.ts`, never hand-edited.
 *
 * WHY THIS EXISTS (2026-11-03 incident)
 * `schema/<name>.graphql` is what `supergraph.local.yaml` composes offline and what
 * `ops/gen-mcp-config.mjs --schema` validates its operations against. When those files fall
 * behind the code, nothing fails at the point of drift — composition still exits 0 and simply
 * produces a supergraph without the fields the subgraph actually serves. Measured on `b1934c6`:
 * `checkInStatus`, `orbitStatus`, `myChildren`, `jobTimeline` and `careFacts` were all absent from
 * the composed supergraph, so `buildInviteParentAuthorizer` failed GraphQL validation (every invite
 * returned 403 UNAUTHORIZED) and the MCP load logged `ERROR field orbitStatus not found`.
 *
 * THE RULE
 * The subgraph module is the only source of truth. Each schema is built with the same call
 * `src/server.ts` uses — `buildSubgraphSchema([{ typeDefs, resolvers }])` — and printed with
 * `printSubgraphSchema`, so a committed file is byte-identical to what that service returns from
 * `_service { sdl }`. Editing a file under `schema/` by hand is now a defect: `npm run schema:check`
 * compares the committed bytes to a fresh render on every CI run and fails with the exact fields.
 *
 * Usage:
 *   npm run schema:gen     # rewrite schema/*.graphql from code
 *   npm run schema:check   # exit 1 naming the drift; writes nothing
 *
 * Both accept `--root <dir>` (defaults to the repository root this file lives in) so the check can
 * be exercised against a copy without touching the checkout.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Kind, parse, print, visit } from 'graphql';
import { buildSubgraphSchema, printSubgraphSchema } from '@apollo/subgraph';

/** Every subgraph in `supergraph.local.yaml`, in the order that file lists them. */
export const SUBGRAPHS = ['village', 'access', 'coordination', 'schedule', 'school', 'transport', 'activities'];

const ROOT_DEFAULT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Build one subgraph with the same call `src/server.ts` uses, then print it the way the service
 * reports it from `_service { sdl }`.
 *
 * Descriptions are stripped deliberately. They are prose carried in `typeDefs`, so leaving them in
 * would make every docstring edit rewrite the artifact and drown the one thing this file exists to
 * review — the type and field surface. Types, fields, arguments, enum values, defaults and applied
 * federation directives are kept exactly as served.
 */
export async function renderSubgraph(name, { root = ROOT_DEFAULT } = {}) {
  const url = pathToFileURL(join(root, 'src', 'subgraphs', `${name}.ts`)).href;
  const mod = await import(url);
  const { typeDefs, resolvers } = mod.default;
  const schema = buildSubgraphSchema([{ typeDefs, resolvers }]);
  const header = `# Generated from src/subgraphs/${name}.ts by ops/gen-subgraph-sdl.mjs — do not edit by hand.\n`;
  return normalise(header + stripDescriptions(printSubgraphSchema(schema)));
}

/** Remove every `description` node from an SDL document. */
export function stripDescriptions(sdl) {
  const ast = visit(parse(sdl), {
    enter(node) {
      if (node.description) return { ...node, description: undefined };
      return undefined;
    },
  });
  return print(ast);
}

/** One trailing newline, no CRLF — a committed file must be reproducible byte for byte. */
export function normalise(text) {
  return `${text.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`;
}

/**
 * `Type.field` for every field in an SDL document, including `extend type` contributions.
 * Used only to make a failure message actionable — the gate itself is a byte comparison.
 */
export function fieldIndex(sdl) {
  const doc = parse(sdl);
  const index = new Set();
  for (const def of doc.definitions) {
    const named =
      def.kind === Kind.OBJECT_TYPE_DEFINITION ||
      def.kind === Kind.OBJECT_TYPE_EXTENSION ||
      def.kind === Kind.INTERFACE_TYPE_DEFINITION ||
      def.kind === Kind.INTERFACE_TYPE_EXTENSION;
    if (!named) continue;
    for (const field of def.fields ?? []) index.add(`${def.name.value}.${field.name.value}`);
  }
  return index;
}

/**
 * Compare committed SDL to a fresh render. `read` and `render` are injectable so the test can
 * prove this check goes red on a file that is genuinely missing a field.
 */
export async function checkAll({
  names = SUBGRAPHS,
  root = ROOT_DEFAULT,
  read = (name) => readFileSync(join(root, 'schema', `${name}.graphql`), 'utf8'),
  render = (name) => renderSubgraph(name, { root }),
} = {}) {
  const drift = [];
  for (const name of names) {
    let committed;
    try {
      committed = normalise(read(name));
    } catch {
      drift.push({ name, kind: 'missing', missing: [], extra: [] });
      continue;
    }
    const rendered = await render(name);
    if (committed === rendered) continue;
    const want = fieldIndex(rendered);
    const have = fieldIndex(committed);
    drift.push({
      name,
      kind: 'stale',
      missing: [...want].filter((f) => !have.has(f)),
      extra: [...have].filter((f) => !want.has(f)),
    });
  }
  return { ok: drift.length === 0, drift };
}

/** Human-readable failure text. Names the fields, because "file differs" is not actionable. */
export function describeDrift(drift) {
  const lines = [];
  for (const entry of drift) {
    if (entry.kind === 'missing') {
      lines.push(`schema/${entry.name}.graphql is MISSING — the subgraph exists in code but has no committed SDL.`);
      continue;
    }
    const sameFields = entry.missing.length === 0 && entry.extra.length === 0;
    lines.push(
      `schema/${entry.name}.graphql is STALE — it no longer matches src/subgraphs/${entry.name}.ts ` +
        (sameFields
          ? '(same field set; directives, arguments or formatting differ)'
          : `(${entry.missing.length} field(s) absent from the SDL, ${entry.extra.length} present only in the SDL).`),
    );
    if (entry.missing.length) lines.push(`  missing from SDL: ${entry.missing.join(', ')}`);
    if (entry.extra.length) lines.push(`  only in SDL:      ${entry.extra.join(', ')}`);
  }
  lines.push('Regenerate with `npm run schema:gen` and commit the result. Never hand-edit schema/*.graphql.');
  return lines.join('\n');
}

async function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag === -1 ? ROOT_DEFAULT : argv[rootFlag + 1];
  const write = argv.includes('--write');

  if (!write && !argv.includes('--check')) {
    console.error('usage: gen-subgraph-sdl.mjs [--check | --write] [--root <dir>]');
    return 2;
  }

  if (write) {
    for (const name of SUBGRAPHS) {
      const text = await renderSubgraph(name, { root });
      writeFileSync(join(root, 'schema', `${name}.graphql`), text);
      console.log(`wrote schema/${name}.graphql (${text.length} bytes)`);
    }
    return 0;
  }

  const { ok, drift } = await checkAll({ root });
  if (ok) {
    console.log(`schema/*.graphql in sync with src/subgraphs/*.ts (${SUBGRAPHS.length} subgraphs).`);
    return 0;
  }
  console.error(describeDrift(drift));
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(2);
    });
}

export { dirname };
