/**
 * Fails if `src/rosina/catalog.ts` (the Rosina service's mirror) and
 * `web/src/features/rosina/catalog.ts` (the web app's authority) disagree on which action ids
 * exist and how each is classified (routeOrHandler / changesData / implemented).
 *
 * Does not execute either file — the web one needs a Vite path alias this plain script does not
 * have. Instead it parses both catalog object literals as text. That is enough to catch the
 * actual drift this check exists for: an id added/removed/renamed on one side only, or a flag
 * flipped on one side only. It does NOT prove the two argsSchema parsers accept/reject the exact
 * same values — see docs/evidence/34-rosina-service.md for that limitation.
 */
import { readFileSync } from 'node:fs';

const ENTRY = /'([a-z-]+)':\s*\{\s*id:\s*'\1',[\s\S]*?routeOrHandler:\s*'([a-z-]+)',\s*changesData:\s*(true|false),\s*implemented:\s*(true|false)\s*\}/g;

function parseCatalog(path) {
  const text = readFileSync(path, 'utf8');
  const out = new Map();
  for (const m of text.matchAll(ENTRY)) {
    const [, id, routeOrHandler, changesData, implemented] = m;
    out.set(id, { routeOrHandler, changesData: changesData === 'true', implemented: implemented === 'true' });
  }
  return out;
}

const web = parseCatalog('web/src/features/rosina/catalog.ts');
const server = parseCatalog('src/rosina/catalog.ts');

if (web.size === 0) throw new Error('parsed 0 entries from the web catalog — the regex no longer matches its format');
if (server.size === 0) throw new Error('parsed 0 entries from the server catalog mirror — the regex no longer matches its format');

const ids = new Set([...web.keys(), ...server.keys()]);
const problems = [];
for (const id of ids) {
  const w = web.get(id);
  const s = server.get(id);
  if (!w) { problems.push(`${id}: present in server mirror, missing from web catalog`); continue; }
  if (!s) { problems.push(`${id}: present in web catalog, missing from server mirror`); continue; }
  for (const key of ['routeOrHandler', 'changesData', 'implemented']) {
    if (w[key] !== s[key]) problems.push(`${id}.${key}: web=${w[key]} server=${s[key]}`);
  }
}

if (problems.length) {
  console.error('ROSINA CATALOG DRIFT:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`rosina-catalog-drift: ${ids.size} action ids identical on both sides (web/src/features/rosina/catalog.ts <-> src/rosina/catalog.ts)`);
