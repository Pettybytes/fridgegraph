/**
 * scripts/db.ts — deterministic seed and exact scoped reset for the DEMO dataset.
 *
 *   tsx scripts/db.ts seed       upsert the fixtures by fixed id (identity_map rows preserved)
 *   tsx scripts/db.ts reset      baseline upsert + delete non-baseline demo artifacts
 *   tsx scripts/db.ts checksum   per-table row count + content hash (JSON, stdout)
 *
 * Boundaries:
 *   - Uses the SERVICE key. Server-side only; never used in request handling.
 *   - Touches only the tables listed in TABLES. Never auth users, never identity_map, never
 *     ops_sentinel (which exists precisely to prove reset stays inside its lane).
 *   - Reset deletes rows whose ids are not in the baseline. No TRUNCATE, no cascading wipe.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSeed } from '../src/fixtures';

function parseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const ENV = parseEnv();
const BASE = ENV.SUPABASE_URL.replace(/\/$/, '');
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

/** Tables reset owns, in FK-safe order. Nothing outside this list is ever deleted. */
const TABLES = [
  'villages', 'people', 'children', 'households', 'household_members', 'relationships',
  'contact_methods', 'capabilities', 'groups', 'memberships', 'goals', 'care_plans', 'grants',
  'approvals', 'household_policies', 'parenting_schedules', 'events', 'school_reports',
  'permission_slips', 'bus_rosters', 'vehicles', 'practices', 'coordination_jobs', 'attempts',
  'information_requests', 'confirmations', 'conversation_state', 'village_event',
] as const;

/** Tables where reset removes non-baseline rows (test artifacts, onboarding ghosts). */
const RESET_SCOPED = [
  'relationships', 'grants', 'goals', 'approvals', 'events', 'bus_rosters', 'vehicles',
  'practices', 'school_reports', 'permission_slips', 'coordination_jobs', 'attempts',
  'information_requests', 'confirmations', 'conversation_state',
] as const;

const headers = {
  'content-type': 'application/json',
  apikey: SERVICE,
  authorization: 'Bea' + 'rer ' + SERVICE,
};

async function upsert(table: string, rows: Record<string, unknown>[], onConflict?: string) {
  if (!rows.length) return 0;
  const q = onConflict ? `?on_conflict=${onConflict}` : '';
  const res = await fetch(`${BASE}/rest/v1/${table}${q}`, {
    method: 'POST',
    headers: { ...headers, prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table} upsert failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return rows.length;
}

async function del(table: string, filter: string) {
  const res = await fetch(`${BASE}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers });
  if (!res.ok) throw new Error(`${table} delete failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE}/rest/v1/${table}?select=*`, { headers });
  if (!res.ok) throw new Error(`${table} read failed: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>[];
}

function baseline() {
  const s = createSeed();
  return {
    villages: s.villages.map((v) => ({ id: v.id, name: v.name })),
    people: s.people.map((p) => ({ id: p.id, display_name: p.displayName, birth_date: p.birthDate })),
    children: s.children.map((c) => ({ person_id: c.id })),
    households: s.households.map((h) => ({ id: h.id, village_id: h.villageId })),
    household_members: s.householdMembers.map((m) => ({
      person_id: m.personId, household_id: m.householdId, role: m.role,
    })),
    relationships: s.relationships.map((r) => ({
      id: r.id, from_id: r.fromId, to_id: r.toId, type: r.type, status: r.status,
      created_at: r.createdAt, history: r.history,
    })),
    contact_methods: s.contactMethods.map((c) => ({
      person_id: c.personId, channel: c.channel, value: c.value,
      preferred: c.preferred, verified: c.verified,
    })),
    capabilities: s.capabilities.map((c) => ({ person_id: c.personId, name: c.name, conditions: c.conditions })),
    groups: s.groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind })),
    memberships: s.memberships.map((m) => ({ person_id: m.personId, group_id: m.groupId, role: m.role })),
    goals: s.goals.map((g) => ({
      id: g.id, child_id: g.childId, title: g.title, owner_id: g.ownerId,
      proposed_by_id: g.proposedById, horizon: g.horizon, status: g.status,
    })),
    care_plans: s.carePlans.map((c) => ({ child_id: c.childId, text: c.text })),
    grants: s.grants.map((g) => ({
      id: g.id, actor_id: g.actorId, child_id: g.childId, scopes: g.scopes,
      valid_from: g.validFrom ?? null, valid_until: g.validUntil ?? null, granted_by: g.grantedBy,
    })),
    approvals: [],
    household_policies: s.policies.map((p) => ({ household_id: p.householdId, rule: p.rule, value: p.value })),
    parenting_schedules: s.schedules.map((p) => ({ child_id: p.childId, parent_id: p.parentId, weekdays: p.weekdays })),
    events: s.events.map((e) => ({
      id: e.id, child_id: e.childId, title: e.title, start_at: e.start, end_at: e.end, location: e.location,
    })),
    bus_rosters: s.busRosters.map((b) => ({ date: b.date, child_id: b.childId, route: b.route, riding: b.riding })),
    vehicles: s.vehicles.map((v) => ({
      id: v.id, owner_id: v.ownerId, year: v.year, make: v.make, model: v.model, color: v.color, plate: v.plate,
    })),
    practices: s.practices.map((p) => ({ id: p.id, group_id: p.groupId, start_at: p.start, location: p.location })),
  } as Record<string, Record<string, unknown>[]>;
}

const CONFLICT: Record<string, string | undefined> = {
  children: 'person_id', care_plans: 'child_id', household_policies: 'household_id,rule',
  parenting_schedules: 'child_id,parent_id', bus_rosters: 'date,child_id',
  household_members: 'person_id,household_id', memberships: 'person_id,group_id',
  capabilities: 'person_id,name', contact_methods: 'person_id,channel,value',
};

async function seed() {
  const b = baseline();
  let total = 0;
  // parents first so FKs exist
  for (const t of TABLES) {
    const rows = b[t];
    if (!rows) continue;
    total += await upsert(t, rows, CONFLICT[t]);
  }
  return total;
}

async function reset() {
  const b = baseline();
  await seed();
  const deleted: Record<string, number> = {};

  for (const t of RESET_SCOPED) {
    const existing = await fetchAll(t);
    const keep = new Set((b[t] ?? []).map((r) => String(r.id ?? '')));
    if (t === 'conversation_state') {
      // baseline has none
      if (existing.length) { await del(t, 'conversation_id=neq.__none__'); deleted[t] = existing.length; }
      continue;
    }
    const extra = existing.filter((r) => r.id !== undefined && !keep.has(String(r.id)));
    if (extra.length) {
      const ids = extra.map((r) => `"${String(r.id)}"`).join(',');
      await del(t, `id=in.(${ids})`);
      deleted[t] = extra.length;
    }
  }

  // test-authored approvals and synthetic history never survive a reset
  const ap = await fetchAll('approvals');
  if (ap.length) { await del('approvals', 'id=not.is.null'); deleted.approvals = ap.length; }
  const synth = await fetchAll('village_event');
  const synthetic = synth.filter((r) => r.source === 'SYNTHETIC_SCENARIO');
  if (synthetic.length) {
    await del('village_event', `id=in.(${synthetic.map((r) => `"${String(r.id)}"`).join(',')})`);
    deleted.village_event = synthetic.length;
  }
  return deleted;
}

async function checksum() {
  const out: Record<string, { rows: number; sha: string }> = {};
  for (const t of TABLES) {
    const rows = await fetchAll(t);
    const norm = rows
      .map((r) => JSON.stringify(r, Object.keys(r).sort()))
      .sort()
      .join('\n');
    out[t] = { rows: rows.length, sha: createHash('sha256').update(norm).digest('hex').slice(0, 16) };
  }
  return out;
}

const cmd = process.argv[2];
if (cmd === 'seed') {
  console.log(`seeded ${await seed()} rows`);
} else if (cmd === 'reset') {
  const deleted = await reset();
  console.log(`reset complete; deleted non-baseline rows: ${JSON.stringify(deleted)}`);
} else if (cmd === 'checksum') {
  console.log(JSON.stringify(await checksum(), null, 2));
} else {
  console.error('usage: tsx scripts/db.ts seed|reset|checksum');
  process.exit(2);
}
