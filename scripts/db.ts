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
import { pathToFileURL } from 'node:url';
import { createSeed } from '../src/fixtures';
import {
  createSimulatedCalendar,
  createSimulatedCareFacts,
  createSimulatedCheckIn,
  createSimulatedCoordination,
  createSimulatedOrbit,
  createSimulatedPrivate,
  SIMULATED_LABEL,
} from '../src/fixtures-simulated';
import { createCastV2 } from '../src/fixtures-cast-v2';

function parseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  let text = '';
  try {
    text = readFileSync('.env', 'utf8');
  } catch {
    // Imported from the server (which loads .env itself) or run in a bare shell.
    return env;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

/**
 * Env is resolved lazily: this module is imported by src/server.ts, whose imports are evaluated
 * before loadEnv() runs. Reading at call time keeps the script and the server on one path.
 */
function envValue(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  return parseEnv()[name] ?? '';
}

function base(): string {
  const url = envValue('SUPABASE_URL');
  if (!url) throw new Error('SUPABASE_URL missing');
  return url.replace(/\/$/, '');
}

function serviceKey(): string {
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  return key;
}

/** Tables reset owns, in FK-safe order. Nothing outside this list is ever deleted. */
const TABLES = [
  'villages', 'people', 'children', 'households', 'household_members', 'relationships',
  'contact_methods', 'capabilities', 'groups', 'memberships', 'goals', 'care_plans', 'grants',
  'approvals', 'household_policies', 'parenting_schedules', 'events', 'school_reports',
  'permission_slips', 'bus_rosters', 'vehicles', 'practices', 'locations', 'coordination_jobs', 'attempts',
  'information_requests', 'confirmations', 'conversation_state', 'village_event', 'routines', 'care_facts',
  'orbit_vocabulary',
] as const;

/** Tables where reset removes non-baseline rows (test artifacts, onboarding ghosts). */
const RESET_SCOPED = [
  'relationships', 'grants', 'goals', 'approvals', 'events', 'bus_rosters', 'vehicles',
  'practices', 'school_reports', 'permission_slips', 'coordination_jobs', 'attempts',
  'information_requests', 'confirmations', 'conversation_state', 'locations', 'webhook_events',
] as const;

function headers() {
  const service = serviceKey();
  return {
    'content-type': 'application/json',
    apikey: service,
    authorization: 'Bea' + 'rer ' + service,
  };
}

async function upsert(table: string, rows: Record<string, unknown>[], onConflict?: string) {
  if (!rows.length) return 0;
  const q = onConflict ? `?on_conflict=${onConflict}` : '';
  const res = await fetch(`${base()}/rest/v1/${table}${q}`, {
    method: 'POST',
    headers: { ...headers(), prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table} upsert failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return rows.length;
}

async function del(table: string, filter: string) {
  const res = await fetch(`${base()}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw new Error(`${table} delete failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function fetchAll(table: string, filtered = false): Promise<Record<string, unknown>[]> {
  // `filtered` only changes how the argument is read: a raw PostgREST filter is appended as-is.
  const query = filtered ? `${table}` : `${table}?select=*`;
  const res = await fetch(`${base()}/rest/v1/${query}`, { headers: headers() });
  if (!res.ok) throw new Error(`${table} read failed: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>[];
}


/**
 * The controlled descriptor vocabulary is REFERENCE data, not fixture data: it must survive
 * `db:reset` exactly like the rest of the baseline. Migration 0034 seeds it once, but a reset that
 * drops non-baseline rows empties the table, so it is seeded here as baseline too.
 */
const COLORS = ['black', 'white', 'grey', 'navy', 'blue', 'red', 'green', 'yellow', 'purple', 'pink', 'orange', 'brown', 'tan', 'beige'];
const VOCABULARY = [
  ...COLORS.map((value) => ({ kind: 'WEAR_COLOR', value, version: 1 })),
  ...['hoodie', 'raincoat', 'jacket', 'coat', 't-shirt', 'sweater', 'dress', 'skirt', 'trousers', 'jeans', 'shorts', 'uniform']
    .map((value) => ({ kind: 'WEAR_GARMENT', value, version: 1 })),
  ...['short', 'long', 'ponytail', 'bun', 'braids', 'curly', 'straight', 'buzz cut']
    .map((value) => ({ kind: 'HAIR', value, version: 1 })),
  ...COLORS.map((value) => ({ kind: 'CARRY_COLOR', value, version: 1 })),
  ...['backpack', 'school bag', 'lunchbox', 'water bottle', 'book bag', 'sports bag', 'instrument case']
    .map((value) => ({ kind: 'CARRY_ITEM', value, version: 1 })),
];

function baseline() {
  const s = createSeed();
  return {
    orbit_vocabulary: VOCABULARY,
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
    locations: s.locations.map((l) => ({
      id: l.id, owner_type: l.ownerType, owner_id: l.ownerId, label: l.label,
      lat: l.lat, lng: l.lng, source: l.source, captured_at: l.capturedAt,
    })),
  } as Record<string, Record<string, unknown>[]>;
}

const CONFLICT: Record<string, string | undefined> = {
  children: 'person_id', care_plans: 'child_id', household_policies: 'household_id,rule',
  parenting_schedules: 'child_id,parent_id', bus_rosters: 'date,child_id',
  household_members: 'person_id,household_id', memberships: 'person_id,group_id',
  capabilities: 'person_id,name', contact_methods: 'person_id,channel,value',
  locations: 'id',
  orbit_vocabulary: 'kind,value',
  care_facts: 'child_id,key',
  villages: 'id',
  households: 'id',
  relationships: 'id',
  grants: 'id',
  routines: 'id',
  events: 'id',
};

export async function seedDatabase() {
  const b = baseline();
  // Cast v2 is BASELINE data: it is demo content the personas depend on, so `db:reset` must preserve
  // it exactly like the vocabulary. Only new rows are added — no baseline row is modified here.
  const cv = createCastV2() as unknown as Record<string, Record<string, unknown>[]>;
  const merged: Record<string, Record<string, unknown>[]> = { ...b };
  for (const [key, rows] of Object.entries(cv)) {
    if (!Array.isArray(rows)) continue;
    merged[key] = [...(merged[key] ?? []), ...rows];
  }
  let total = 0;
  // parents first so FKs exist
  for (const t of TABLES) {
    const raw = merged[t];
    if (!raw) continue;
    // PostgREST needs one key set per batch. `events.status` defaults to confirmed in the database,
    // so rows that omit it are given the same value rather than being dropped or rewritten.
    const rows = t === 'events'
      ? raw.map((r) => ({ status: 'confirmed', ...r }))
      : raw;
    total += await upsert(t, rows, CONFLICT[t]);
  }
  return total;
}

/**
 * Applies the SIMULATED coordination fixture. Additive and idempotent by fixed id; it never touches
 * a baseline row and never creates a real-call authorization.
 */
export async function seedSimulated(): Promise<Record<string, number | string>> {
  const s = createSimulatedCoordination();
  const c = createSimulatedCalendar();
  const counts: Record<string, number | string> = { label: SIMULATED_LABEL };
  counts.jobs = await upsert('coordination_jobs', s.coordination_jobs as unknown as Record<string, unknown>[], 'id');
  counts.attempts = await upsert('attempts', s.attempts as unknown as Record<string, unknown>[], 'id');
  counts.holidays = await upsert('holidays', c.holidays, 'id');
  counts.routines = await upsert('routines', c.routines, 'id');
  counts.adult_availability = await upsert('adult_availability', c.adult_availability, 'id');
  counts.holiday_arrangements = await upsert('holiday_arrangements', c.holiday_arrangements, 'id');
  // A NON-SANDBOX household the Demo guide must NOT see (guide-seam audit). Identifier prefix `fx_`.
  const priv = createSimulatedPrivate();
  counts.households = await upsert('households', priv.households, 'id');
  counts.people = await upsert('people', priv.people, 'id');
  counts.children = await upsert('children', priv.children, 'person_id');
  counts.household_members = await upsert('household_members', priv.household_members, 'person_id,household_id');
  // Events LAST: the audit event references the audit child, which must exist first.
  counts.events = await upsert('events', c.events, 'id');
  // The Ellison orbit audience policy (Scenario 8: Andre included). Fixture-owned until Group 4.
  const o = createSimulatedOrbit();
  counts.household_policies = await upsert('household_policies', o.household_policies, 'household_id,rule');
  const ci = createSimulatedCheckIn();
  counts.expected_checkins = await upsert('expected_checkins', ci.expected_checkins, 'id');
  const cf = createSimulatedCareFacts();
  counts.care_facts = await upsert('care_facts', cf.care_facts, 'child_id,key');
  return counts;
}

/**
 * Removes EXACTLY the fixture rows and nothing else: `fixture = true` on the marked tables, plus the
 * `fx_` identifier prefix on the tables that have no marker column. Baseline rows are never touched,
 * so the baseline checksum returns byte-identical.
 */
export async function cleanupSimulated(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  const countRows = async (table: string, filter: string) =>
    (await fetchAll(`${table}?${filter}`, true)).length;

  // Children before jobs (attempts reference jobs), then the audit household set child-first.
  for (const [table, filter] of [
    ['events', 'fixture=eq.true'],
    ['expected_checkins', 'fixture=eq.true'],
    ['check_ins', 'fixture=eq.true'],
    ['care_facts', 'fixture=eq.true'],
    ['attempts', 'fixture=eq.true'],
    ['coordination_jobs', 'fixture=eq.true'],
    ['holiday_arrangements', 'fixture=eq.true'],
    ['adult_availability', 'fixture=eq.true'],
    ['routines', 'fixture=eq.true'],
    ['holidays', 'fixture=eq.true'],
    ['household_members', 'household_id=like.fx_*'],
    ['children', 'person_id=like.fx_*'],
    ['households', 'id=like.fx_*'],
    ['people', 'id=like.fx_*'],
    // Fixture-owned orbit policy: the rule name is the handle (table has no marker column).
    ['household_policies', 'rule=eq.orbit_notify_eligible'],
  ] as const) {
    const n = await countRows(table, filter);
    if (n > 0) await del(table, filter);
    deleted[table] = n;
  }
  return deleted;
}

/** Checksum of the SIMULATED fixture's own tables only — never compared to the v1 baseline. */
export async function checksumSimulated() {
  const out: Record<string, { rows: number; sha: string }> = {};
  const c = createSimulatedCalendar();
  const ids: Record<string, string[]> = {
    coordination_jobs: createSimulatedCoordination().coordination_jobs.map((r) => String(r.id)),
    attempts: createSimulatedCoordination().attempts.map((r) => String(r.id)),
    holidays: c.holidays.map((r) => String(r.id)),
    routines: c.routines.map((r) => String(r.id)),
    adult_availability: c.adult_availability.map((r) => String(r.id)),
    holiday_arrangements: c.holiday_arrangements.map((r) => String(r.id)),
    household_policies: ['orbit_notify_eligible'],
    expected_checkins: createSimulatedCheckIn().expected_checkins.map((r) => String(r.id)),
    care_facts: createSimulatedCareFacts().care_facts.map((r) => String(r.id)),
    check_ins: [],
  };
  for (const t of Object.keys(ids)) {
    const all = await fetchAll(t);
    const wanted = new Set(ids[t]);
    const rows = t === 'household_policies'
      ? all.filter((r) => wanted.has(String(r.rule)))
      : all.filter((r) => wanted.has(String(r.id)));
    const norm = rows.map((r) => JSON.stringify(r, Object.keys(r).sort())).sort().join('\n');
    out[t] = { rows: rows.length, sha: createHash('sha256').update(norm).digest('hex').slice(0, 16) };
  }
  return out;
}

export async function resetDatabase() {
  const b = baseline();
  await seedDatabase();
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

/**
 * Restore the COMPLETE demo-ready fixture set from the SAME single source `db:seed` uses.
 *
 * Why this exists: `resetDatabase()` is the v1 baseline reset, and its "keep" set is the v1 baseline
 * ids. Cast v2 is seeded by `seedDatabase()` and then deleted again by that same reset for every
 * table in RESET_SCOPED — so the demo cast (Priya's grants, the nanny relationship, approval
 * policies, care facts, Orbit vocabulary, the simulated calendar) silently disappears after the
 * evidence suite runs.
 *
 * This does NOT redefine the v1 contract: `baseline()`, `resetDatabase()` and `checksumDatabase()`
 * are unchanged, so the baseline reset/checksum semantics stay exactly as published. This is an
 * ADDITIVE restore that runs after a suite (and in its `finally`, so a failed suite restores too).
 *
 * Idempotent: both halves upsert by fixed id / natural key.
 */
export async function restoreDemoCast() {
  const cast = await seedDatabase();      // v1 baseline + ALL of Cast v2 (one merged source)
  const simulated = await seedSimulated(); // simulated coordination + calendar + orbit policy + care facts
  return { cast, simulated };
}

export async function checksumDatabase() {
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

// CLI only when executed directly (`tsx scripts/db.ts ...`), never when imported by the server.
const executedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  const cmd = process.argv[2];
  if (cmd === 'seed') {
    console.log(`seeded ${await seedDatabase()} rows`);
  } else if (cmd === 'seed:simulated') {
    console.log(`seeded ${SIMULATED_LABEL} fixture: ${JSON.stringify(await seedSimulated())}`);
  } else if (cmd === 'cleanup:simulated') {
    console.log(`cleaned SIMULATED fixture: ${JSON.stringify(await cleanupSimulated())}`);
  } else if (cmd === 'checksum:simulated') {
    console.log(JSON.stringify(await checksumSimulated()));
    process.exit(0);
  } else if (cmd === 'restore:demo') {
    const out = await restoreDemoCast();
    console.log(`restored demo cast: ${JSON.stringify({ castRows: out.cast, simulated: out.simulated })}`);
  } else if (cmd === 'reset') {
    const deleted = await resetDatabase();
    console.log(`reset complete; deleted non-baseline rows: ${JSON.stringify(deleted)}`);
  } else if (cmd === 'checksum') {
    console.log(JSON.stringify(await checksumDatabase(), null, 2));
  } else {
    console.error('usage: tsx scripts/db.ts seed|seed:simulated|cleanup:simulated|restore:demo|reset|checksum|checksum:simulated');
    process.exit(2);
  }
}
