/**
 * createDemoFamily — one sandbox household with ONE persona, created at runtime.
 *
 * WHAT A CREATED FAMILY IS: a village, a household, a parent person, a child person (`children` row),
 * the two memberships, and a real Supabase Auth user whose subject is mapped to the parent personId.
 * Everything is `sandbox = true`, so the Demo guide can read it and reset can remove it.
 *
 * WHAT IT IS NOT: it is not a visitor account and not a second way to pick an identity. The registry
 * row (`demo_families`, 0049) is the ONLY list of created personas; the login route resolves an id
 * through it and still mints through Supabase Auth like every other persona.
 *
 * PRIVILEGE: creating the auth user uses the admin API with the service-role key, exactly as
 * `session.ts` already does for `generateLink`. It is never used for a data-path query — the rows are
 * written over the same owner connection reset uses.
 *
 * REMOVAL: `deleteCreatedFamilies` runs INSIDE reset's transaction and returns the registry rows;
 * `purgeFamilyArtifacts` then removes the identity-map entries and (best effort) the auth users. A
 * deleted mapping is what makes an old access token resolve to nobody.
 */
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { identityMapPath, type DemoPersona } from './personas';

const LOCK_KEY = 918_273_645; // same advisory lock reset takes: one demo write at a time
const MAX_NAME = 80;
const MAX_FAMILIES = 8;

export type CreatedFamily = { id: string; childId: string; parentName: string; childName: string };

export type FamilyRow = {
  id: string;
  persona_id: string;
  person_id: string;
  child_id: string;
  household_id: string;
  village_id: string;
  email: string;
  auth_user_id: string;
  parent_name: string;
  child_name: string;
};

export class FamilyError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'FamilyError';
  }
}

function client(): pg.Client {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new FamilyError('FAMILY_UNAVAILABLE', 503);
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
}

/** Trimmed, non-empty, printable, bounded. Returns null rather than guessing. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > MAX_NAME) return null;
  // No control characters: a name is displayed, not interpreted.
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

async function createAuthUser(email: string): Promise<string> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) throw new FamilyError('FAMILY_UNAVAILABLE', 503);

  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: service, authorization: `Bearer ${service}` },
    body: JSON.stringify({
      email,
      // Never used: sign-in is a magic link. Random so no password exists anywhere by design.
      password: randomBytes(24).toString('base64url'),
      email_confirm: true,
      app_metadata: { demo: true },
    }),
  });
  if (!res.ok) {
    console.error('[demo-family] auth user create failed:', res.status);
    throw new FamilyError('FAMILY_CREATE_FAILED', 500);
  }
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new FamilyError('FAMILY_CREATE_FAILED', 500);
  return body.id;
}

async function deleteAuthUser(id: string): Promise<void> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return;
  try {
    await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: service, authorization: `Bearer ${service}` },
    });
  } catch {
    // Best effort by design: the identity MAPPING is what closes the door, and it is already gone.
  }
}

function readMap(): Record<string, string> {
  const path = identityMapPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Atomic rewrite so a crash cannot leave a half-written map that maps nobody. */
function writeMap(map: Record<string, string>): void {
  const path = identityMapPath();
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(map, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Test-only fault injection. There is no production flag: the hook is null in every normal run, and
 * setting it is refused under NODE_ENV=production, exactly like the other test hooks.
 *
 * The stages mirror the real ordering, so a proof can fail each boundary and assert the end state:
 *   before-auth    nothing exists yet
 *   before-commit  auth user exists, rows are uncommitted (rollback)
 *   after-commit   rows + identity_map + registry committed, JSON map not yet written
 *   after-file     everything written, then the caller fails
 */
export type FamilyStage = 'before-auth' | 'before-commit' | 'after-commit' | 'after-file';
let faultHook: ((stage: FamilyStage) => void | Promise<void>) | null = null;

function assertNotProduction(hook: string): void {
  if (process.env.NODE_ENV === 'production') throw new Error(`${hook} is unavailable in production`);
}

export function __setFamilyFaultHook(fn: ((stage: FamilyStage) => void | Promise<void>) | null): void {
  assertNotProduction('__setFamilyFaultHook');
  faultHook = fn;
}

async function passStage(stage: FamilyStage): Promise<void> {
  if (faultHook) await faultHook(stage);
}

function removeMapEntry(authUserId: string): void {
  const map = readMap();
  if (!(authUserId in map)) return;
  delete map[authUserId];
  writeMap(map);
}

export async function createDemoFamily(input: { parentName: unknown; childName: unknown }): Promise<CreatedFamily> {
  const parentName = cleanName(input.parentName);
  const childName = cleanName(input.childName);
  if (!parentName || !childName) throw new FamilyError('INVALID_NAME', 400);

  const suffix = randomBytes(4).toString('hex');
  const personaId = `family-${suffix}`;
  const personId = `p_family_${suffix}`;
  const childId = `p_family_child_${suffix}`;
  const householdId = `h_family_${suffix}`;
  const villageId = `v_family_${suffix}`;
  const email = `family.${suffix}@example.com`;

  const c = client();
  await c.connect();
  let authUserId = '';
  let committed = false;

  /**
   * Idempotent undo. Every step is safe when its row is absent, so a failure at ANY stage leaves the
   * same end state: no rows, no identity_map row, no registry row (so no picker entry and no login),
   * no JSON mapping and no auth user. A half-created family is never merely "unusable" — it is gone.
   */
  const compensate = async (): Promise<void> => {
    if (committed) {
      await c.query(`delete from identity_map where user_id = $1`, [authUserId]).catch(() => undefined);
      await c.query(`delete from household_members where household_id = $1`, [householdId]).catch(() => undefined);
      await c.query(`delete from children where person_id = $1`, [childId]).catch(() => undefined);
      await c.query(`delete from households where id = $1`, [householdId]).catch(() => undefined);
      await c.query(`delete from people where id in ($1,$2)`, [personId, childId]).catch(() => undefined);
      await c.query(`delete from villages where id = $1`, [villageId]).catch(() => undefined);
      await c.query(`delete from demo_families where id = $1`, [personaId]).catch(() => undefined);
    } else {
      await c.query('rollback').catch(() => undefined);
    }
    if (authUserId) {
      try { removeMapEntry(authUserId); } catch { /* a failed write leaves no entry: nothing to undo */ }
      await deleteAuthUser(authUserId);
    }
  };

  try {
    // Cap first: a runaway loop in a kiosk must not mint unlimited identities.
    const count = await c.query(`select count(*)::int n from demo_families`);
    if (Number(count.rows[0]?.n ?? 0) >= MAX_FAMILIES) throw new FamilyError('FAMILY_LIMIT', 429);

    await passStage('before-auth');
    authUserId = await createAuthUser(email);

    await c.query('begin');
    await c.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]);

    await c.query(`insert into villages (id, name) values ($1, $2)`, [villageId, `${parentName}'s village`]);
    await c.query(`insert into people (id, display_name, birth_date) values ($1, $2, $3)`, [
      personId, parentName, '1985-01-01',
    ]);
    await c.query(`insert into people (id, display_name, birth_date) values ($1, $2, $3)`, [
      childId, childName, '2016-01-01',
    ]);
    await c.query(`insert into children (person_id) values ($1)`, [childId]);
    await c.query(`insert into households (id, village_id, sandbox) values ($1, $2, true)`, [householdId, villageId]);
    await c.query(`insert into household_members (person_id, household_id, role) values ($1, $2, 'parent')`, [
      personId, householdId,
    ]);
    await c.query(`insert into household_members (person_id, household_id, role) values ($1, $2, 'child')`, [
      childId, householdId,
    ]);
    // TWO identity mappings, both required: RLS's current_person() reads this TABLE, the bearer
    // verifier reads the JSON file. Writing only one gives a persona that signs in and is denied.
    await c.query(`insert into identity_map (user_id, person_id) values ($1, $2)`, [authUserId, personId]);
    await c.query(
      `insert into demo_families
         (id, persona_id, person_id, child_id, household_id, village_id, email, auth_user_id, parent_name, child_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [personaId, personaId, personId, childId, householdId, villageId, email, authUserId, parentName, childName],
    );

    await passStage('before-commit');
    await c.query('commit');
    committed = true;

    // Mapping LAST. The file cannot join the transaction, so it is written after commit and every
    // failure after this point (including one after the write) unwinds the committed rows too.
    await passStage('after-commit');
    const map = readMap();
    map[authUserId] = personId;
    writeMap(map);

    await passStage('after-file');
    return { id: personaId, childId, parentName, childName };
  } catch (error) {
    await compensate();
    throw error instanceof FamilyError ? error : new FamilyError('FAMILY_CREATE_FAILED', 500);
  } finally {
    await c.end();
  }
}

/** Registry rows as picker personas. Read on demand; the list is tiny. */
export async function listFamilyPersonas(): Promise<DemoPersona[]> {
  const c = client();
  await c.connect();
  try {
    const r = await c.query(
      `select persona_id, person_id, email, parent_name, child_name, village_id
         from demo_families order by created_at`,
    );
    return r.rows.map((row) => ({
      id: String(row.persona_id),
      personId: String(row.person_id),
      email: String(row.email),
      name: String(row.parent_name),
      role: `${String(row.child_name)}'s parent · created for this demo`,
      childId: String(row.child_id),
      childName: String(row.child_name),
      villageId: String(row.village_id),
      grants: [] as string[],
      parent: true,
      initialRoute: 'calendar' as const,
    }));
  } catch {
    return [];
  } finally {
    await c.end();
  }
}

export async function familyPersona(personaId: string): Promise<DemoPersona | null> {
  const all = await listFamilyPersonas();
  return all.find((p) => p.id === personaId) ?? null;
}

/**
 * Delete every created family's DATA inside the caller's transaction. Returns the registry rows so
 * reset can purge the identity mapping and the auth users after it commits.
 */
export async function deleteCreatedFamilies(c: pg.Client): Promise<FamilyRow[]> {
  const r = await c.query(`select * from demo_families`);
  const rows = (r.rows as FamilyRow[]).map((x) => ({ ...x }));

  // Reconciling sweep for a crash that left ONE of the two mappings behind. Created-family ids are
  // namespaced (`p_family_*`), so an orphan is identifiable without guessing.
  const orphanMap = await c.query(
    `select user_id, person_id from identity_map
      where person_id like 'p_family_%'
        and person_id not in (select person_id from demo_families)`,
  );
  for (const o of orphanMap.rows) {
    const member = await c.query(`select household_id from household_members where person_id = $1 limit 1`, [o.person_id]);
    const householdId = member.rows[0]?.household_id as string | undefined;
    // The whole household goes, not just the orphaned parent: its child person and the village it
    // sits in are part of the same half-created family.
    let childIds: string[] = [];
    let villageId: string | undefined;
    if (householdId) {
      const members = await c.query(`select person_id, role from household_members where household_id = $1`, [householdId]);
      childIds = members.rows.filter((r) => r.role === 'child').map((r) => String(r.person_id));
      villageId = (await c.query(`select village_id from households where id = $1`, [householdId])).rows[0]?.village_id;
    }
    await c.query(`delete from identity_map where user_id = $1`, [o.user_id]);
    await c.query(`delete from household_members where person_id = $1`, [o.person_id]);
    if (householdId) await c.query(`delete from household_members where household_id = $1`, [householdId]);
    for (const childId of childIds) await c.query(`delete from children where person_id = $1`, [childId]);
    await c.query(`delete from children where person_id = $1`, [o.person_id]);
    if (householdId) await c.query(`delete from households where id = $1`, [householdId]);
    if (villageId) await c.query(`delete from villages where id = $1`, [villageId]);
    await c.query(`delete from people where id = any($1)`, [[o.person_id, ...childIds]]);
    rows.push({ auth_user_id: String(o.user_id), person_id: String(o.person_id) } as FamilyRow);
  }

  for (const f of rows) {
    if (!f.household_id) continue;
    await c.query(`delete from household_members where household_id = $1`, [f.household_id]);
    await c.query(`delete from children where person_id = $1`, [f.child_id]);
    await c.query(`delete from households where id = $1`, [f.household_id]);
    await c.query(`delete from people where id in ($1,$2)`, [f.person_id, f.child_id]);
    await c.query(`delete from villages where id = $1`, [f.village_id]);
  }
  if (rows.length) await c.query(`delete from demo_families`);
  return rows;
}


/** After the reset transaction commits: drop the mappings, then best-effort delete the users. */
export async function purgeFamilyArtifacts(rows: FamilyRow[]): Promise<void> {
  const map = readMap();
  let changed = false;
  for (const f of rows) {
    if (f.auth_user_id && f.auth_user_id in map) { delete map[f.auth_user_id]; changed = true; }
  }
  // The reverse orphan: a FILE entry that maps to a `p_family_*` persona the registry does not have.
  // Only namespaced ids are considered, so no seeded persona can ever be swept away.
  const registry = await registryPersonIds();
  const sweptSubs: string[] = [];
  for (const [sub, person] of Object.entries(map)) {
    if (typeof person !== 'string' || !person.startsWith('p_family_')) continue;
    if (registry.has(person)) continue;
    delete map[sub];
    sweptSubs.push(sub);
    changed = true;
  }
  if (changed) writeMap(map);
  for (const f of rows) if (f.auth_user_id) await deleteAuthUser(f.auth_user_id);
  // A swept file entry names its own auth user, so that orphan is deleted too rather than lingering.
  for (const sub of sweptSubs) await deleteAuthUser(sub);
}

/** personIds currently registered. Read after the reset commit, so the sweep sees the end state. */
async function registryPersonIds(): Promise<Set<string>> {
  const c = client();
  await c.connect();
  try {
    const r = await c.query(`select person_id from demo_families`);
    return new Set(r.rows.map((x) => String(x.person_id)));
  } catch {
    return new Set();
  } finally {
    await c.end();
  }
}
