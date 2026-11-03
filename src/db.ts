/**
 * Per-request Postgres access through supabase-js.
 *
 * Every request builds its OWN client from the publishable key plus the caller's Authorization
 * header, so PostgREST resolves `auth.uid()` and Row Level Security is what actually decides
 * visibility. No service-role key is ever used in request handling — grep for
 * SERVICE_ROLE in src/ finds nothing.
 *
 * The client is cached on the request's Ctx object only: one client per request, never shared
 * across callers.
 */
import { GraphQLError } from 'graphql';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Ctx } from './authz';

export type Db = SupabaseClient;

/** Env is read lazily: imports are evaluated before loadEnv() runs. */
export function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new GraphQLError('DB_UNAVAILABLE', { extensions: { code: 'DB_UNAVAILABLE' } });
  return url.replace(/\/$/, '');
}

function publishableKey(): string {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new GraphQLError('DB_UNAVAILABLE', { extensions: { code: 'DB_UNAVAILABLE' } });
  return key;
}

/** Build (or reuse) this request's RLS-scoped client. Requires a verified token. */
export function dbFor(ctx: Ctx): Db {
  if (ctx.db) return ctx.db;
  const token = ctx.token;
  if (!token) {
    // Reaching here means a resolver read data before checking identity.
    throw new GraphQLError('UNAUTHENTICATED', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  ctx.db = createClient(supabaseUrl(), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return ctx.db;
}

/** Per-request memo so a single query does not repeat the same authorization read. */
export function memo<T>(ctx: Ctx, key: string, fn: () => Promise<T>): Promise<T> {
  if (!ctx.memo) ctx.memo = new Map<string, Promise<unknown>>();
  const hit = ctx.memo.get(key);
  if (hit) return hit as Promise<T>;
  const p = fn();
  ctx.memo.set(key, p as Promise<unknown>);
  return p;
}

/**
 * Postgres `insufficient_privilege`. RLS decides WHICH rows a caller may see (a denial is 200 + zero
 * rows); 42501 means the object itself is not readable by the role — a deployment/privilege defect,
 * not an authorization refusal. Reporting it as an outage (or worse, as UNAUTHORIZED) misleads both
 * the operator and the caller.
 */
const PRIVILEGE_CODES = new Set(['42501']);

export type DbErrorCode = 'DB_UNAVAILABLE' | 'DB_PRIVILEGE';

/** Classify a database failure into one opaque code. Never returns UNAUTHORIZED. */
export function dbErrorCode(error: { code?: string }): DbErrorCode {
  return error.code && PRIVILEGE_CODES.has(error.code) ? 'DB_PRIVILEGE' : 'DB_UNAVAILABLE';
}

/**
 * A database error is never a client-visible detail. Log the code, return one opaque code.
 * A 401/403 from PostgREST means the token did not reach the database as a signed-in user,
 * which is a configuration failure, not a denial: denials are 200 + zero rows.
 *
 * The message is the code itself, so no table name, SQL text or role name can leak into a response.
 */
export function dataError(error: { code?: string; message?: string; details?: string }): GraphQLError {
  const code = dbErrorCode(error);
  console.error('[db]', code, error.code ?? '-', error.message ?? '-');
  return new GraphQLError(code, { extensions: { code } });
}

export type Row = Record<string, unknown>;

/** Query helper: unwraps `{data,error}`, returning rows or throwing an opaque error. */
export async function rows(query: PromiseLike<{ data: Row[] | null; error: unknown }>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw dataError(error as { code?: string; message?: string });
  return data ?? [];
}

/** Same, for `.single()` / `.maybeSingle()` shaped responses. */
export async function one(query: PromiseLike<{ data: Row | null; error: unknown }>): Promise<Row | null> {
  const { data, error } = await query;
  if (error) throw dataError(error as { code?: string; message?: string });
  return data ?? null;
}
