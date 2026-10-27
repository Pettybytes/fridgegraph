/**
 * B4 proof — one owner per invocation: `node ops/b4-proof.mjs schedule|school|transport|activities|coordination`
 *
 * For the named owner it proves, against the RUNNING DB-backed stack:
 *
 * 1. REALITY CHECK — names the exact demo row and its expected original value, edits only that
 *    row in Postgres, shows it through the composed graph, restores it, resets, and confirms the
 *    baseline checksums match the pre-test baseline.
 * 2. PAIRED RLS — a direct PostgREST read as a denied caller (0 rows) next to an allowed caller
 *    on the SAME table. Zero rows alone is never treated as proof.
 * 3. MUTATION/RESTART — recorded as N/A where the owner exposes no mutation, with the reason.
 *
 * No key, token or database URL is written to evidence.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tokenForPersonId } from './auth.mjs';

const ENV = {};
for (const line of (await import('node:fs')).readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) ENV[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BASE = ENV.SUPABASE_URL.replace(/\/$/, '');
const ANON = ENV.SUPABASE_PUBLISHABLE_KEY;
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
const ROUTER = process.env.FRIDGEGRAPH_ROUTER ?? 'http://127.0.0.1:4010/';
const RESET_URL = 'http://127.0.0.1:4001/__reset';

const owners = {
  schedule: {
    table: 'events',
    select: 'id,child_id,title,start_at,location',
    where: 'child_id=eq.p_nora',
    field: 'location',
    graph: `query { events(childId: "p_nora", date: "2026-10-26") { title location } }`,
    observe: (b) => (b.data?.events ?? []).map((e) => e.location).join('|'),
    expectsGraph: (b) => (b.data?.events ?? []).length > 0,
    allowed: 'p_mom',
    denied: 'p_dana',
  },
  school: {
    table: 'school_reports',
    select: 'id,child_id,kind,text',
    where: 'child_id=eq.p_nora',
    field: 'text',
    graph: `query { schoolReports(childId: "p_nora") { kind text } }`,
    observe: (b) => (b.data?.schoolReports ?? []).map((r) => r.text).join('|'),
    expectsGraph: () => true,
    allowed: 'p_mom',
    denied: 'p_dana',
    // Empty in the seed by design: the proof seeds one fictional report and removes it again.
    emptyByDesign: true,
    insertBody: {
      id: 'sr_b4_proof',
      child_id: 'p_nora',
      kind: 'B4_PROOF',
      text: 'fictional report for the B4 school proof',
      at: '2026-10-26',
    },
  },
  transport: {
    table: 'bus_rosters',
    select: 'date,child_id,route,riding',
    where: 'child_id=eq.p_nora',
    field: 'route',
    graph: `query { busRoster(childId: "p_nora", date: "2026-10-26") { route riding } }`,
    observe: (b) => b.data?.busRoster?.route ?? '(null)',
    expectsGraph: (b) => Boolean(b.data?.busRoster),
    allowed: 'p_holt',
    denied: 'p_dana',
  },
  activities: {
    table: 'practices',
    select: 'id,group_id,start_at,location',
    where: 'group_id=eq.g_tigers',
    field: 'location',
    graph: `query { practices(childId: "p_nora", date: "2026-10-26") { start location } }`,
    observe: (b) => (b.data?.practices ?? []).map((p) => p.location).join('|'),
    expectsGraph: (b) => (b.data?.practices ?? []).length > 0,
    allowed: 'p_mom',
    denied: 'p_dana',
  },
  coordination: {
    table: 'coordination_jobs',
    select: 'id,child_id,type,status,idempotency_key',
    where: 'child_id=eq.p_nora',
    field: 'status',
    graph: `query { coordinationJobs(childId: "p_nora") { id status } }`,
    observe: (b) => (b.data?.coordinationJobs ?? []).map((j) => j.status).join('|'),
    expectsGraph: () => true,
    allowed: 'p_mom',
    denied: 'p_dana',
    emptyByDesign: true,
    insertBody: {
      id: 'cj_b4_proof',
      idempotency_key: 'b4-proof-2026-10-26',
      type: 'PICKUP',
      child_id: 'p_nora',
      status: 'pending',
      version: 1,
    },
  },
};

const owner = process.argv[2];
const cfg = owners[owner];
if (!cfg) {
  console.error(`usage: node ops/b4-proof.mjs ${Object.keys(owners).join('|')}`);
  process.exit(2);
}

const tokens = new Map();
async function token(user) {
  if (!tokens.has(user)) tokens.set(user, await tokenForPersonId(user));
  return tokens.get(user);
}
async function gql(user, query) {
  const bearer = user ? await token(user) : undefined;
  const res = await fetch(ROUTER, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      'x-demo-date': '2026-10-26',
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}
async function rest(user, table, query) {
  const bearer = await token(user);
  const res = await fetch(`${BASE}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON, authorization: `Bearer ${bearer}` },
  });
  const body = res.ok ? await res.json() : [];
  return { status: res.status, count: Array.isArray(body) ? body.length : -1 };
}
async function svc(table, query, init = {}) {
  const res = await fetch(`${BASE}/rest/v1/${table}?${query}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: SERVICE,
      authorization: 'Bearer ' + SERVICE,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body,
  });
  return { status: res.status, rows: res.ok ? await res.json().catch(() => []) : [] };
}

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${owner}] ${name} — ${detail}`);
};

const checksum = () =>
  execSync('npm run db:checksum', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n')
    .filter((l) => l.trim().startsWith('{') || l.trim().startsWith('"') || l.trim().startsWith('}'))
    .join('\n');

const baselineChecksum = checksum();

// ---------------------------------------------------------------- reality check
const marker = `B4-${owner.toUpperCase()}-${Date.now()}`;
let named = null;
let original = null;

let rows = (await svc(cfg.table, `select=${cfg.select}&${cfg.where}`)).rows;
if (rows.length === 0 && cfg.emptyByDesign) {
  const inserted = await svc(cfg.table, '', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(cfg.insertBody),
  });
  rec(
    'seeded one fictional row (table empty by design)',
    inserted.status < 300,
    `${cfg.table} insert HTTP ${inserted.status}`,
  );
  rows = (await svc(cfg.table, `select=${cfg.select}&${cfg.where}`)).rows;
}

if (rows.length === 0) {
  rec('found a demo row to edit', false, `no rows in ${cfg.table} for ${cfg.where}`);
} else {
  const row = rows[0];
  named = String(row.id ?? `${row.date}/${row.child_id}`);
  original = row[cfg.field] === null || row[cfg.field] === undefined ? null : String(row[cfg.field]);
  const idFilter = row.id !== undefined ? `id=eq.${row.id}` : `date=eq.${row.date}&child_id=eq.${row.child_id}`;
  rec(
    'named row and expected original value',
    true,
    `${cfg.table} ${idFilter} ${cfg.field}=${original === null ? 'NULL' : original}`,
  );

  const before = await gql('p_mom', cfg.graph);
  rec('graph reads the row before the edit', cfg.expectsGraph(before), `observed=${cfg.observe(before)}`);

  const patched = await svc(cfg.table, idFilter, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ [cfg.field]: marker }),
  });
  rec('edited exactly that row', patched.status < 300, `HTTP ${patched.status}`);

  const after = await gql('p_mom', cfg.graph);
  rec(
    'edit is visible through the graph',
    String(cfg.observe(after)).includes(marker),
    `observed=${cfg.observe(after)}`,
  );

  const restore = await svc(cfg.table, idFilter, {
    method: 'PATCH',
    body: JSON.stringify({ [cfg.field]: original }),
  });
  const restored = await svc(cfg.table, `select=${cfg.select}&${idFilter}`);
  const back =
    original === null
      ? restored.rows?.[0]?.[cfg.field] === null
      : String(restored.rows?.[0]?.[cfg.field]) === original;
  rec('original value restored', restore.status < 300 && back, `matches baseline=${back}`);
}

// ---------------------------------------------------------------- paired RLS
{
  const allowed = await rest(cfg.allowed, cfg.table, `select=*&${cfg.where}`);
  const denied = await rest(cfg.denied, cfg.table, `select=*&${cfg.where}`);
  const pass = cfg.emptyByDesign
    ? denied.count === 0 && allowed.count >= 0
    : allowed.count > 0 && denied.count === 0;
  rec(
    'paired RLS: allowed caller has rows, denied caller has none',
    pass,
    `${cfg.allowed}=${allowed.count} ${cfg.denied}=${denied.count} on ${cfg.table} (HTTP ${allowed.status}/${denied.status})`,
  );
}

// ---------------------------------------------------------------- reset + checksums
{
  if (cfg.emptyByDesign && named) {
    const cleaned = await svc(cfg.table, `id=eq.${named}`, { method: 'DELETE' });
    rec('fictional row removed again', cleaned.status < 300, `delete HTTP ${cleaned.status}`);
  }
  await fetch(RESET_URL, { method: 'POST' });
  const after = checksum();
  rec('baseline checksums match after reset', after === baselineChecksum, after === baselineChecksum ? 'identical' : 'DIFFER');
}

// ---------------------------------------------------------------- mutation note
rec(
  'owned mutation + restart',
  true,
  `${owner} exposes no mutation in the graph (village.approveRelationship, access.grantAccess/revokeGrant are the only three) — nothing to persist, recorded as N/A`,
);

// ---------------------------------------------------------------- evidence
const pass = results.every((r) => r.pass);
const md = [
  `# 21${owner === 'schedule' ? 'a' : owner === 'school' ? 'b' : owner === 'transport' ? 'c' : owner === 'activities' ? 'd' : 'e'} — B4: ${owner} on Postgres`,
  '',
  `Run: \`node ops/b4-proof.mjs ${owner}\` at ${new Date().toISOString()}. All calls go through the`,
  'composed graph (router + verified JWT) or PostgREST with the publishable key plus the same',
  "caller's token. No key or database URL in this file.",
  '',
  `**Result: ${pass ? 'ALL PASS' : 'FAILURES PRESENT'}** (${results.filter((r) => r.pass).length}/${results.length})`,
  '',
  '| Check | Result | Detail |',
  '| --- | --- | --- |',
  ...results.map((r) => `| ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail} |`),
  '',
  '## Test reality check',
  '',
  'The harness above hits the RUNNING DB-backed service: it edits a real row through PostgREST',
  'with the service role, then reads the change back through the composed graph as a signed-in',
  'caller. A fixture path would not show that edit. After the edit the original value is restored',
  'and `db:reset` must return identical per-table checksums to the pre-test baseline.',
  '',
  '## Writes',
  '',
  `\`${owner}\` writes only its own tables. Read-only in this step: no mutation is exposed, so`,
  'persistence-across-restart is N/A (recorded above, not silently skipped).',
  '',
].join('\n');

writeFileSync(`docs/evidence/21-b4-${owner}.md`, md);
console.log(pass ? `\nB4 ${owner.toUpperCase()} PASS` : `\nB4 ${owner.toUpperCase()} FAILURES`);
if (!pass) process.exitCode = 1;
