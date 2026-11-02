/**
 * Identity-map planning and persistence.
 *
 * WHY THIS IS ITS OWN MODULE
 * `scripts/seed-auth-users.ts` used to build `data/identity-map.json` from `.demo-credentials`. Any
 * existing auth user whose stored password was missing or rejected was skipped, and was therefore
 * omitted from the map that was then written over the working file. Eleven personas went UNAVAILABLE
 * with no error — that is the incident this module exists to prevent, and these functions are pure or
 * injectable so the rule can be tested without a project, a network or a database.
 *
 * THE RULES
 *   1. an existing auth user is ALWAYS in the map, whatever the state of its stored password;
 *   2. a write that would drop an identity already in the file is refused unless loss is explicit;
 *   3. an empty map is never written;
 *   4. the previous file is kept as `<path>.last-good` and restored if the write or the caller's
 *      follow-up step (the database sync) fails.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export type PersonLike = { personId: string };
export type FoundUser = { id: string };
export type StoredCredential = { personId?: string; userId?: string; password?: string };

export type Plan<T extends PersonLike = PersonLike> = {
  /** personId -> auth user id. Existing users are included regardless of password state. */
  resolved: Map<string, string>;
  /** People with no auth user yet; the caller creates them and adds them to `resolved`. */
  toCreate: T[];
  /** People whose stored password should be verified; a failure does not remove them from `resolved`. */
  verify: Array<{ personId: string; email: string; password: string }>;
  skipped: Array<{ personId: string; email: string; reason: string }>;
};

/**
 * Pure planning. No network, no filesystem: given who exists and what is stored, decide the map and
 * the work. The important line is `resolved.set(person.personId, found.id)` — it runs before any
 * credential branch, which is exactly what the incident was missing.
 */
export function planIdentities<T extends PersonLike>(
  people: T[],
  byEmail: Map<string, FoundUser>,
  creds: Record<string, StoredCredential>,
  emailFor: (person: T) => string,
): Plan<T> {
  const plan: Plan<T> = { resolved: new Map(), toCreate: [], verify: [], skipped: [] };

  for (const person of people) {
    const email = emailFor(person);
    const found = byEmail.get(email);

    if (!found) {
      plan.toCreate.push(person);
      continue;
    }

    plan.resolved.set(person.personId, found.id);

    const stored = creds[email];
    if (stored?.password && stored.userId === found.id) {
      plan.verify.push({ personId: person.personId, email, password: stored.password });
      continue;
    }
    plan.skipped.push({
      personId: person.personId,
      email,
      reason: 'exists, no usable stored password — needs an explicit reset',
    });
  }

  return plan;
}

/** userId -> personId, the shape the servers load. */
export function mapFromResolved(resolved: Map<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [personId, userId] of resolved) map[userId] = personId;
  return map;
}

export type SafetyVerdict =
  | { ok: true }
  | { ok: false; code: 'EMPTY' }
  | { ok: false; code: 'LOSS'; lost: string[] };

/**
 * Guards a write. `lost` is reported as person ids, never as raw map contents.
 * The caller decides how to present the refusal; nothing is written here.
 */
export function checkMapSafety(
  previous: Record<string, string>,
  next: Record<string, string>,
  allowLoss = false,
): SafetyVerdict {
  if (Object.keys(next).length === 0) return { ok: false, code: 'EMPTY' };
  if (allowLoss) return { ok: true };
  const lost = Object.entries(previous)
    .filter(([userId]) => !(userId in next))
    .map(([, personId]) => personId);
  return lost.length > 0 ? { ok: false, code: 'LOSS', lost } : { ok: true };
}

export type MapDeps = {
  writeFileSync: typeof writeFileSync;
  chmodSync: typeof chmodSync;
};

export function readMapFile(path: string): Record<string, string> {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Write the map, run the follow-up step, and restore the previous file if either fails.
 * The `.last-good` copy is written first and is never deleted by a failure.
 */
export async function writeMapThen(
  path: string,
  next: Record<string, string>,
  previousText: string | null,
  afterWrite: () => Promise<void> | void,
  deps: MapDeps = { writeFileSync, chmodSync },
): Promise<void> {
  if (previousText !== null) {
    try {
      const parsed = JSON.parse(previousText) as Record<string, string>;
      if (Object.keys(parsed).length > 0) {
        deps.writeFileSync(`${path}.last-good`, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
      }
    } catch {
      // A corrupt previous file is not worth preserving as "last good".
    }
  }

  try {
    deps.writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    deps.chmodSync(path, 0o600);
    await afterWrite();
  } catch (error) {
    if (previousText !== null) {
      try {
        deps.writeFileSync(path, previousText, { mode: 0o600 });
        deps.chmodSync(path, 0o600);
      } catch {
        // The restore is best-effort; the thrown error below carries the real failure.
      }
    }
    throw error;
  }
}
