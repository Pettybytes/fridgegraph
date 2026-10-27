/**
 * 22 — practices_read: is the caller authorized for a PLAYER in that group?
 *
 * The B4 activities run reported `p_dana` reading 1 practices row as an RLS gap. It is not one:
 * Jax is a Tigers player (memberships: p_jax / g_tigers / player), and `practices_read` asks
 * `is_parent_of(m.person_id) or has_scope(m.person_id, 'schedule.read')` — both of which are
 * current_person()-anchored SECURITY DEFINER helpers, i.e. already evaluated for the CALLER.
 * Dana's row is correct access through her own child. The test premise was wrong, not the policy.
 *
 * This script proves three things and then leaves no trace:
 *   1. WHO gets the row, and the reason for each non-zero result (every zero next to a one).
 *   2. The guard actually FIRES: withdraw the player who carries a caller's access and that
 *      caller's result must move. A guard that never fires would also look "unchanged".
 *   3. The no-op case, stated as such: withdrawing Jax leaves Kendra's result at 1 because Nora
 *      is still a player — Kendra's access never depended on Jax.
 *
 * Cleanup: Jax's membership row is restored, and the run asserts the group is back to exactly one
 * membership for Jax. No row outside the demo data is created.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tokenForPersonId } from './auth.mjs';

const ENV = {};
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) ENV[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BASE = ENV.SUPABASE_URL.replace(/\/$/, '');
const ANON = ENV.SUPABASE_PUBLISHABLE_KEY;
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
const GROUP = 'g_tigers';
const PRACTICE = 'pr_tigers_1026';

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
};

const svcHeaders = () => ({
  apikey: SERVICE,
  authorization: 'Bearer ' + SERVICE,
  'content-type': 'application/json',
  prefer: 'return=representation',
});

async function seenBy(caller) {
  const bearer = await tokenForPersonId(caller);
  const res = await fetch(`${BASE}/rest/v1/practices?select=id,group_id,location`, {
    headers: { apikey: ANON, authorization: `Bearer ${bearer}` },
  });
  const body = await res.json();
  return { status: res.status, count: Array.isArray(body) ? body.length : -1 };
}

async function jaxTigersMemberships() {
  const res = await fetch(
    `${BASE}/rest/v1/memberships?select=person_id,group_id,role&person_id=eq.p_jax&group_id=eq.${GROUP}`,
    { headers: svcHeaders() },
  );
  return res.json();
}

// ---------------------------------------------------------------- 1. who sees it, and why
const callers = {
  p_mom: 'parent of Nora (player)',
  p_dana: 'parent of Jax (player)',
  p_evelyn: "schedule.read grant for Jax (player)",
  p_price: 'no schedule.read, not a parent',
  p_holt: 'transport.read only',
  p_chris: 'careplan grant expired 2026-09-30',
};
const baseline = {};
for (const caller of Object.keys(callers)) baseline[caller] = await seenBy(caller);

rec(
  'every non-zero row traces to a player in that group',
  baseline.p_mom.count === 1 && baseline.p_dana.count === 1 && baseline.p_evelyn.count === 1,
  `kendra=${baseline.p_mom.count} dana=${baseline.p_dana.count} evelyn=${baseline.p_evelyn.count} (each authorized for a player)`,
);
rec(
  'callers with no authorization see zero on the same table',
  baseline.p_price.count === 0 && baseline.p_holt.count === 0 && baseline.p_chris.count === 0,
  `angela=${baseline.p_price.count} gary=${baseline.p_holt.count} chris=${baseline.p_chris.count} — same table, HTTP ${baseline.p_price.status}`,
);

// ---------------------------------------------------------------- 2. the guard fires
const before = await jaxTigersMemberships();
rec(
  'Jax is a Tigers player before the test',
  before.length === 1,
  `memberships p_jax/${GROUP} = ${before.length} (${before[0]?.role ?? 'none'})`,
);

const withdrawn = await fetch(
  `${BASE}/rest/v1/memberships?person_id=eq.p_jax&group_id=eq.${GROUP}`,
  { method: 'DELETE', headers: svcHeaders() },
);
rec('withdrew Jax (the departing player)', withdrawn.status < 300, `HTTP ${withdrawn.status}`);

const afterDana = await seenBy('p_dana');
const afterKendra = await seenBy('p_mom');
rec(
  'Dana moves 1 -> 0 (her access came through Jax)',
  baseline.p_dana.count === 1 && afterDana.count === 0,
  `dana before=${baseline.p_dana.count} after=${afterDana.count} — the guard FIRED`,
);
rec(
  'Kendra stays 1 (no-op: Nora is still a player)',
  baseline.p_mom.count === 1 && afterKendra.count === 1,
  `kendra before=${baseline.p_mom.count} after=${afterKendra.count} — access never depended on Jax`,
);

// ---------------------------------------------------------------- 3. cleanup, verified
const restored = await fetch(`${BASE}/rest/v1/memberships`, {
  method: 'POST',
  headers: svcHeaders(),
  body: JSON.stringify({ person_id: 'p_jax', group_id: GROUP, role: 'player' }),
});
const after = await jaxTigersMemberships();
const danaBack = await seenBy('p_dana');
rec(
  'membership restored, exactly one row',
  restored.status < 300 && after.length === 1 && after[0].role === 'player',
  `restored HTTP ${restored.status}; rows=${after.length} role=${after[0]?.role ?? 'none'}`,
);
rec(
  'results back to baseline',
  danaBack.count === baseline.p_dana.count,
  `dana=${danaBack.count} (baseline ${baseline.p_dana.count})`,
);

execSync('npm run db:reset', { stdio: 'pipe' });
const afterReset = await seenBy('p_dana');
rec('reset leaves the baseline intact', afterReset.count === 1, `dana after reset=${afterReset.count}`);

// ---------------------------------------------------------------- evidence
const pass = results.every((r) => r.pass);
const md = [
  '# 22 — practices_read: caller-relative, and the guard actually fires',
  '',
  `Run: \`node ops/practices-authz.mjs\` at ${new Date().toISOString()}.`,
  'All reads are direct PostgREST with the publishable key plus the caller\'s own token.',
  '',
  `**Result: ${pass ? 'PASS' : 'FAILURES PRESENT'}** (${results.filter((r) => r.pass).length}/${results.length})`,
  '',
  '| Check | Result | Detail |',
  '| --- | --- | --- |',
  ...results.map((r) => `| ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail} |`),
  '',
  '## The reported "gap" was a bad test premise',
  '',
  `B4 activities reported \`p_dana\` reading 1 row of \`practices\` as a gap in \`practices_read\`.`,
  `It is not. Jax is a **player in ${GROUP}** (\`memberships: p_jax / ${GROUP} / player\`), and the policy`,
  'asks:',
  '',
  '```sql',
  'exists (select 1 from memberships m',
  '        where m.group_id = practices.group_id and m.role = \'player\'',
  '          and (is_parent_of(m.person_id) or has_scope(m.person_id, \'schedule.read\')))',
  '```',
  '',
  '`is_parent_of()` and `has_scope()` are SECURITY DEFINER helpers that read `current_person()`',
  'internally, so the predicate is already evaluated for the CALLER against a player in that',
  'group. Dana is Jax\'s parent; her one row is correct access through her own child. The policy',
  'was **not** changed, because changing it would have broken correct behaviour to satisfy a wrong',
  'expectation. Recorded callers and their reasons:',
  '',
  '```json',
  JSON.stringify(callers, null, 2),
  '```',
  '',
  '## Why the withdrawal test exists',
  '',
  'An assertion that nothing changes cannot tell "correctly unchanged" from "guard never ran".',
  'Withdrawing Jax moves Dana 1 -> 0, which is how we know the predicate is really evaluated per',
  'caller per membership rather than optimistically returning rows. Kendra staying at 1 is the',
  'genuine no-op, and the reason is stated: Nora is still a player, so Kendra\'s access never',
  'depended on Jax.',
  '',
  '## Follow-up worth flagging (not a security fix)',
  '',
  '`practices_read` authorizes on *any* group the player belongs to, while the `activities`',
  'resolver only surfaces team groups. A parent with `schedule.read` for a player therefore reads',
  'practices for that player\'s non-team groups too. Nothing sensitive is in that table today;',
  'it is a scoping question, not a leak, and it is left as the policy is.',
  '',
].join('\n');

writeFileSync('docs/evidence/22-practices-authorization.md', md);
console.log(pass ? '\nPRACTICES AUTHZ PASS' : '\nPRACTICES AUTHZ FAILURES');
if (!pass) process.exitCode = 1;
