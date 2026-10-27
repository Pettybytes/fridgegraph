/**
 * Shared sign-in helpers for the evidence runner and the MCP probe.
 *
 * Tokens live in memory only and are never written to disk or printed. On-disk evidence redacts
 * them. Passwords come from .demo-credentials (gitignored); the servers never read that file.
 */
import { readFileSync } from 'node:fs';

function parseEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const ENV = parseEnv();
const CREDS = JSON.parse(readFileSync('.demo-credentials', 'utf8'));
const BASE = ENV.SUPABASE_URL.replace(/\/$/, '');
const cache = new Map();

export function emailForPersonId(personId) {
  const hit = Object.entries(CREDS).find(([, v]) => v.personId === personId);
  if (!hit) throw new Error(`no demo credential for ${personId}`);
  return hit[0];
}

/** Password-grant sign-in. Returns the access token; never logs it. */
export async function tokenForPersonId(personId) {
  if (cache.has(personId)) return cache.get(personId);
  const email = emailForPersonId(personId);
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ENV.SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ email, password: CREDS[email].password }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${personId}: HTTP ${res.status}`);
  const body = await res.json();
  if (!body.access_token) throw new Error(`sign-in for ${personId} returned no token`);
  cache.set(personId, body.access_token);
  return body.access_token;
}

/** Never write a real token into evidence. */
export function redactBearer(token) {
  if (!token) return '(none)';
  return `Bearer ${token.slice(0, 6)}…<redacted, ${token.length} chars>`;
}
