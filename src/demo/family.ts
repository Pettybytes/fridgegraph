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
  try {
    // Cap first: a runaway loop in a kiosk must not mint unlimited identities.
    const count = await c.query(`select count(*)::int n from demo_families`);
    if (Number(count.rows[0]?.n ?? 0) >= MAX_FAMILIES) throw new FamilyError('FAMILY_LIMIT', 429);

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
    // TWO identity mappings, both required: RLS's current_person() reads this TABLE, and the
    // bearer verifier reads the JSON file. Writing only one leaves a persona that signs in and then
    // sees nothing (proven by the proof run before this line existed).
    await c.query(`insert into identity_map (user_id, person_id) values ($1, $2)`, [authUserId, personId]);
    await c.query(
      `insert into demo_families
         (id, persona_id, person_id, child_id, household_id, village_id, email, auth_user_id, parent_name, child_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [personaId, personaId, personId, childId, householdId, villageId, email, authUserId, parentName, childName],
    );
    await c.query('commit');
    committed = true;

    // Mapping LAST: a family without a mapping is invisible to the verifier, which is the safe
    // direction. If it fails, nothing created here may survive.
    const map = readMap();
    map[authUserId] = personId;
    writeMap(map);

    return { id: personaId, childId, parentName, childName };
  } catch (error) {
    if (committed) {
      // Mapping failed after the rows landed: undo the rows so nothing half-created remains.
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
    if (authUserId) await deleteAuthUser(authUserId);
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
  const rows = r.rows as FamilyRow[];
  for (const f of rows) {
    // The DB mapping goes with the data: an old token must stop being a person, not just a member.
    await c.query(`delete from identity_map where user_id = $1`, [f.auth_user_id]);
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
  if (!rows.length) return;
  const map = readMap();
  for (const f of rows) delete map[f.auth_user_id];
  writeMap(map);
  for (const f of rows) await deleteAuthUser(f.auth_user_id);
}
