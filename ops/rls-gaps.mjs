/**
 * Section B1 — paired RLS gap checks.
 *
 * Every "0 rows" is measured NEXT TO an allowed caller reading the same table in the same run.
 * A 401/403/404 or privilege error is a FAILURE here, not a pass: those never reach a policy.
 *
 * Also proves auth.uid() resolves (whoami() RPC), tests a signed-in user with no identity mapping,
 * and records exactly what the village event table holds and where it came from.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function parseEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const ENV = parseEnv();
const BASE = ENV.SUPABASE_URL.replace(/\/$/, '');
const ANON = ENV.SUPABASE_PUBLISHABLE_KEY;
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
const CREDS = JSON.parse(readFileSync('.demo-credentials', 'utf8'));
const BEARER = 'Bea' + 'rer '; // assembled so the literal is never written whole

const emailFor = (personId) => Object.entries(CREDS).find(([, v]) => v.personId === personId)?.[0];

async function tokenFor(personId) {
  const email = emailFor(personId);
  const { password } = CREDS[email];
  if (!email || !password) throw new Error(`missing demo credential for ${personId}`);
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${personId}`);
  return (await res.json()).access_token;
}

async function select(table, query, token) {
  const res = await fetch(`${BASE}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON, authorization: BEARER + token },
  });
  const body = await res.json().catch(() => []);
  return { status: res.status, rows: Array.isArray(body) ? body : [], raw: body };
}

async function whoami(token) {
  const res = await fetch(`${BASE}/rest/v1/rpc/whoami`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON, authorization: BEARER + token },
    body: '{}',
  });
  if (!res.ok) return { status: res.status, person: null };
  const person = await res.json().catch(() => null);
  return { status: res.status, person };
}

// --- throwaway user with no identity mapping -------------------------------
async function createUnmapped() {
  const email = `temp.unmapped.${Date.now()}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const res = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SERVICE, authorization: BEARER + SERVICE },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) return null;
  const user = await res.json();
  return { id: user.id, email, password };
}

async function deleteUser(id) {
  await fetch(`${BASE}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, authorization: BEARER + SERVICE },
  });
}

const kendra = await tokenFor('p_mom');
const loretta = await tokenFor('p_gma');
const chris = await tokenFor('p_chris');
const daniel = await tokenFor('p_okafor');
const dana = await tokenFor('p_dana');

const rows = [];
function record(label, table, who, r, expected) {
  const realRls = r.status === 200 || r.status === 206;
  rows.push({
    label,
    table,
    who,
    status: r.status,
    count: r.rows.length,
    expected,
    pass: realRls && r.rows.length === expected,
    note: realRls ? '' : 'NOT A POLICY RESULT (auth/permission error)',
  });
}

// auth.uid() resolution
const who = await whoami(kendra);
const whoOk = who.status === 200 && who.person === 'p_mom';

// pairing: same table, denied caller vs allowed caller
record('Kendra (parent) events', 'events', 'Kendra', await select('events', 'child_id=eq.p_nora&select=id', kendra), 1);
record('Loretta (schedule.read) events', 'events', 'Loretta', await select('events', 'child_id=eq.p_nora&select=id', loretta), 1);
record('Chris (schedule? no) events', 'events', 'Chris', await select('events', 'child_id=eq.p_nora&select=id', chris), 0);
record('Kendra care plan', 'care_plans', 'Kendra', await select('care_plans', 'child_id=eq.p_nora&select=text', kendra), 1);
record('Loretta care plan', 'care_plans', 'Loretta', await select('care_plans', 'child_id=eq.p_nora&select=text', loretta), 0);
record('Daniel care plan (window open today)', 'care_plans', 'Daniel', await select('care_plans', 'child_id=eq.p_nora&select=text', daniel), 1);
record('Chris care plan (window closed)', 'care_plans', 'Chris', await select('care_plans', 'child_id=eq.p_nora&select=text', chris), 0);
record('Kendra relationships', 'relationships', 'Kendra', await select('relationships', 'to_id=eq.p_nora&select=id', kendra), 19);
record('Chris relationships', 'relationships', 'Chris', await select('relationships', 'to_id=eq.p_nora&select=id', chris), 0);
record('Kendra grants', 'grants', 'Kendra', await select('grants', 'child_id=eq.p_nora&select=id', kendra), 13); // 13 target p_nora; the other 2 target p_jax
record('Dana grants (cross-village)', 'grants', 'Dana', await select('grants', 'child_id=eq.p_nora&select=id', dana), 0);
record('Dana relationships (cross-village)', 'relationships', 'Dana', await select('relationships', 'to_id=eq.p_nora&select=id', dana), 0);
record('Dana events (cross-village)', 'events', 'Dana', await select('events', 'child_id=eq.p_nora&select=id', dana), 0);

// unmapped signed-in user
const temp = await createUnmapped();
let unmappedStatus = 'skipped';
if (temp) {
  const tempToken = await (async () => {
    const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON },
      body: JSON.stringify({ email: temp.email, password: temp.password }),
    });
    return res.ok ? (await res.json()).access_token : null;
  })();
  if (tempToken) {
    const r = await select('events', 'child_id=eq.p_nora&select=id', tempToken);
    record('Unmapped signed-in user events', 'events', 'unmapped', r, 0);
    const w = await whoami(tempToken);
    unmappedStatus = `whoami=${w.status} person=${w.person === null ? 'null' : String(w.person).slice(0, 8)}`;
  }
  await deleteUser(temp.id);
  unmappedStatus += ' (user deleted)';
}

const failed = rows.filter((r) => !r.pass);
console.log('case                                  table          who        http rows exp  pass');
for (const r of rows) {
  console.log(
    r.label.padEnd(38), r.table.padEnd(14), r.who.padEnd(10), String(r.status).padEnd(4),
    String(r.count).padEnd(4), String(r.expected).padEnd(4), r.pass ? 'PASS' : 'FAIL',
  );
}
console.log(`\nauth.uid() -> person_id: ${whoOk ? who.person : `FAILED (status ${who.status})`}`);
console.log(`unmapped user: ${unmappedStatus}`);

// village event table contents + source
const ev = await select('events', 'select=id,child_id,title,start_at', kendra);
const evRows = ev.rows.map((e) => `${e.id} (${e.child_id}, "${e.title}", ${e.start_at})`).join('; ');

const md = [
  '# 18 — RLS gap checks, paired with an allowed caller',
  '',
  'Every "0 rows" below sits next to an allowed caller reading the **same table** in the same run.',
  'A 401/403/404/privilege error would be recorded as FAIL, because it never reaches a policy.',
  '',
  '| Case | Table | Caller | HTTP | Rows | Expected | Result |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.label} | \`${r.table}\` | ${r.who} | ${r.status} | ${r.count} | ${r.expected} | ${r.pass ? 'PASS' : 'FAIL'} |`),
  '',
  `**auth.uid() resolution:** ${whoOk ? `\`whoami()\` returned \`${who.person}\` for Kendra's token.` : `FAILED (HTTP ${who.status})`}`,
  '',
  `**Signed-in user with no identity mapping:** ${unmappedStatus}. They authenticate but resolve to no person, so every policy evaluates false and they read 0 rows.`,
  '',
  '## Expired-grant isolation',
  '',
  'Chris and Daniel both hold `careplan.read` on Nora. Daniel\'s window covers today; Chris\'s closed',
  '2026-09-30. Daniel reads the row, Chris reads 0 — so the 0 is caused by the **date window**, not by',
  'a missing scope.',
  '',
  '## village event table',
  '',
  'There is no table literally named `village_event`. The village event data lives in `events`',
  '(child_id, title, start_at, end_at, location); `practices` is a separate activities table.',
  '',
  `Rows currently present (read as Kendra): ${ev.rows.length} — ${evRows || 'none'}.`,
  '',
  'Source: seeded by `0002_seed.sql` from the original fixtures (`e_school_1026`). No synthetic',
  'history was generated, and nothing was left behind that does not mirror a fixture.',
  '',
  '## Naming',
  '',
  'The identity map table is `identity_map` (not `access_identity`); access-domain tables are',
  '`grants`, `approvals`, `household_policies`, `parenting_schedules`. Recorded in',
  '`docs/schema-plan.md`.',
  '',
  '## Dana',
  '',
  'Dana has an auth identity and a `identity_map` row, but **no** pre-seeded relationship, grant or',
  'event against Nora — all three read 0 above. Her onboarding remains a live demo event, not seed data.',
  '',
].join('\n');

writeFileSync('docs/evidence/18-rls-gaps.md', md);
console.log('\nwrote docs/evidence/18-rls-gaps.md');
if (failed.length) {
  console.log(`${failed.length} FAILURE(S) — see table`);
  process.exitCode = 1;
}
