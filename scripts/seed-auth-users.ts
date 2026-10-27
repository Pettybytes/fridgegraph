/**
 * Creates the Milestone 2A demo auth users in Supabase.
 *
 * SECURITY
 * - Reads SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY from .env.
 * - The service-role key is used only here (server-side) and is never logged or written anywhere.
 * - Never prints passwords, tokens, full auth responses, or the service key.
 * - Writes generated passwords only to .demo-credentials (gitignored, mode 600).
 * - Writes the server-side identity map to data/identity-map.json (gitignored).
 *
 * IDEMPOTENT: existing demo users are reused, never duplicated and never silently overwritten.
 * If a user exists but no usable stored password is available, it is REPORTED and skipped rather
 * than having its password replaced behind your back.
 *
 * Run: npx tsx scripts/seed-auth-users.ts
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type DemoPerson = { personId: string; first: string; last: string };
type Credential = { personId: string; userId: string; password: string };

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const ENV_PATH = join(ROOT, '.env');
const CREDS_PATH = join(ROOT, '.demo-credentials');
const MAP_PATH = join(ROOT, 'data', 'identity-map.json');

/** One user per fixture person used in evidence. Fictional names, unreachable emails. */
const PEOPLE: DemoPerson[] = [
  { personId: 'p_mom', first: 'Kendra', last: 'Ellison' },
  { personId: 'p_dad', first: 'Andre', last: 'Ellison' },
  { personId: 'p_gma', first: 'Loretta', last: 'Brooks' },
  { personId: 'p_bryan', first: 'Bryan', last: 'Brooks' },
  { personId: 'p_walter', first: 'Walter', last: 'Ellison' },
  { personId: 'p_price', first: 'Angela', last: 'Price' },
  { personId: 'p_okafor', first: 'Daniel', last: 'Okafor' },
  { personId: 'p_holt', first: 'Gary', last: 'Holt' },
  { personId: 'p_chris', first: 'Chris', last: 'Harlan' },
  { personId: 'p_dana', first: 'Dana', last: 'Coleman' },
  { personId: 'p_ray', first: 'Ray', last: 'Coleman' },
  { personId: 'p_evelyn', first: 'Evelyn', last: 'Carter' },
  { personId: 'p_priya', first: 'Priya', last: 'Nair' },
];

function loadEnv(): { url: string; publishable: string; service: string } {
  if (!existsSync(ENV_PATH)) throw new Error('.env not found');
  const env: Record<string, string> = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  const url = env.SUPABASE_URL;
  const publishable = env.SUPABASE_PUBLISHABLE_KEY;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !url && 'SUPABASE_URL',
    !publishable && 'SUPABASE_PUBLISHABLE_KEY',
    !service && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);
  if (missing.length) throw new Error(`missing env: ${missing.join(', ')}`);
  return { url: url.replace(/\/$/, ''), publishable, service };
}

const emailFor = (p: DemoPerson) => `${p.first}.${p.last}@example.com`.toLowerCase();

/** Admin API errors: report status + message, never the body wholesale. */
async function adminError(res: Response, what: string): Promise<never> {
  let detail = '';
  try {
    const body = (await res.json()) as { msg?: string; message?: string; error?: string };
    detail = body.msg ?? body.message ?? body.error ?? '';
  } catch {
    detail = '(no json body)';
  }
  throw new Error(`${what} failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
}

async function listUsers(base: string, service: string): Promise<{ id: string; email?: string }[]> {
  const users: { id: string; email?: string }[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: service, authorization: `Bearer ${service}` },
    });
    if (!res.ok) await adminError(res, 'list users');
    const body = (await res.json()) as { users?: { id: string; email?: string }[] };
    const batch = body.users ?? [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

async function createUser(
  base: string,
  service: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: service,
      authorization: `Bearer ${service}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) await adminError(res, `create ${email}`);
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error(`create ${email}: response had no id`);
  return body.id;
}

/** True when the stored password still signs in. Never prints the token. */
async function canSignIn(
  base: string,
  publishable: string,
  email: string,
  password: string,
): Promise<boolean> {
  const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: publishable },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { access_token?: string };
  return Boolean(body.access_token);
}

function readCreds(): Record<string, Credential> {
  if (!existsSync(CREDS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CREDS_PATH, 'utf8')) as Record<string, Credential>;
  } catch {
    return {};
  }
}

const { url, publishable, service } = loadEnv();
console.log(`[seed] project host: ${new URL(url).host}`);

const existing = await listUsers(url, service);
const byEmail = new Map(existing.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u]));
console.log(`[seed] ${existing.length} auth user(s) already in the project`);

const creds = readCreds();
const created: string[] = [];
const reused: string[] = [];
const skipped: string[] = [];

for (const person of PEOPLE) {
  const email = emailFor(person);
  const found = byEmail.get(email);

  if (found) {
    const stored = creds[email];
    if (stored?.password && stored.userId === found.id) {
      const ok = await canSignIn(url, publishable, email, stored.password);
      if (ok) {
        reused.push(`${person.personId} <${email}>`);
        continue;
      }
      skipped.push(`${person.personId} <${email}> exists, stored password rejected — needs an explicit reset`);
      continue;
    }
    skipped.push(`${person.personId} <${email}> exists, no usable stored password — needs an explicit reset`);
    continue;
  }

  const password = randomBytes(24).toString('base64url');
  const userId = await createUser(url, service, email, password);
  creds[email] = { personId: person.personId, userId, password };
  created.push(`${person.personId} <${email}>`);
}

// .demo-credentials: passwords only for humans/scripts, never read by the servers.
writeFileSync(CREDS_PATH, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
chmodSync(CREDS_PATH, 0o600);

// data/identity-map.json: the ONLY identity source the servers load (sub -> personId).
mkdirSync(dirname(MAP_PATH), { recursive: true });
const map: Record<string, string> = {};
for (const cred of Object.values(creds)) map[cred.userId] = cred.personId;
writeFileSync(MAP_PATH, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
chmodSync(MAP_PATH, 0o600);

console.log(`\n[seed] created ${created.length}:`);
for (const line of created) console.log(`  + ${line}`);
console.log(`[seed] reused ${reused.length}:`);
for (const line of reused) console.log(`  = ${line}`);
if (skipped.length) {
  console.log(`[seed] skipped ${skipped.length} (NOT modified):`);
  for (const line of skipped) console.log(`  ! ${line}`);
}
console.log(
  `\n[seed] wrote .demo-credentials (mode 600) and data/identity-map.json (${Object.keys(map).length} identities)`,
);
console.log('[seed] no password, token, user id or service key was printed');
