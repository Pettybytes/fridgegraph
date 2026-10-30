/**
 * Authorization, backed by Postgres.
 *
 * Identity is a verified Supabase JWT (src/auth/verify.ts) resolved to a village person.
 * Every rule here reads through the caller's OWN RLS-scoped client (src/db.ts), so the database
 * enforces visibility and this layer enforces policy. Both must agree; neither is trusted alone.
 *
 * Access-owned data (grants) is read here and only here: subgraphs call these helpers instead of
 * querying `grants` themselves, and no subgraph writes access-owned tables.
 *
 * x-demo-date survives only as a test clock and only under DEMO_CLOCK=1.
 */
import { GraphQLError } from 'graphql';
import { dbFor, memo, one, rows, type Db } from './db';

export type Ctx = {
  callerId?: string;
  today: string;
  identityError?: string;
  /** The caller's raw bearer token; used only to build the per-request RLS client. */
  token?: string;
  /** This request's RLS-scoped client (lazy, cached per request). */
  db?: Db;
  /** Per-request memo of repeated authorization reads. */
  memo?: Map<string, Promise<unknown>>;
  /** Verified `app_metadata.demo` marker. True only for a demo persona's real session. */
  demo?: boolean;
  /** Verified `app_metadata.demo_guide` marker. Read-only guide over sandbox records. */
  demoGuide?: boolean;
};

/** Field-level scopes, as strings in data — never enums. */
export const SCOPE = {
  schedule: 'schedule.read',
  transport: 'transport.read',
  goals: 'goals.read',
  careplan: 'careplan.read',
  school: 'school.read',
  contacts: 'contacts.read',
  pickupVerify: 'pickup.verify',
  pickupRequest: 'pickup.request',
  superviseRequest: 'supervise.request',
} as const;

export function deny(): GraphQLError {
  return new GraphQLError('UNAUTHORIZED', { extensions: { code: 'UNAUTHORIZED' } });
}

/**
 * No verified identity: absent, expired, wrong signature/issuer/audience, or an unmapped `sub`.
 * UNAUTHENTICATED means "I do not know who you are"; UNAUTHORIZED means "I know, and no".
 */
export function unauthenticated(): GraphQLError {
  return new GraphQLError('UNAUTHENTICATED', { extensions: { code: 'UNAUTHENTICATED' } });
}

/** Missing or unverifiable caller -> UNAUTHENTICATED. Returns the caller id when valid. */
export function requireCaller(ctx: Ctx): string {
  const callerId = ctx?.callerId;
  if (!callerId) throw unauthenticated();
  return callerId;
}

/**
 * Defence in depth for anything that reaches a real person: a demo session is refused in the
 * resolver, and the same call is refused again inside the database by is_demo_caller(). Neither
 * layer is trusted alone, and this one is never the only gate.
 *
 * Simulated work (a sandbox job, a TEST_RESPONDER attempt, a parent approval) is NOT refused here —
 * refusing it would delete the demo. Only real outreach is.
 */
export function refuseDemoOutreach(ctx: Ctx): void {
  if (ctx?.demo === true) {
    throw new GraphQLError('DEMO_OUTREACH_REFUSED', { extensions: { code: 'DEMO_OUTREACH_REFUSED' } });
  }
}

/** A guide may read sandbox records and nothing else; every write path calls this first. */
export function refuseDemoGuideWrite(ctx: Ctx): void {
  if (ctx?.demoGuide === true) {
    throw new GraphQLError('DEMO_GUIDE_READ_ONLY', { extensions: { code: 'DEMO_GUIDE_READ_ONLY' } });
  }
}

export type GrantRow = {
  id: string;
  actor_id: string;
  child_id: string;
  scopes: string[];
  valid_from: string | null;
  valid_until: string | null;
  granted_by: string;
};

/** Day-granular window: both bounds inclusive, both optional. Dates are local-calendar dates. */
export function inWindow(g: { valid_from?: string | null; valid_until?: string | null }, onDate: string): boolean {
  const from = g.valid_from ? String(g.valid_from).slice(0, 10) : null;
  const until = g.valid_until ? String(g.valid_until).slice(0, 10) : null;
  if (from && onDate < from) return false;
  if (until && onDate > until) return false;
  return true;
}

/** Households the child belongs to (the child is a `child` member). Readable by the child's household. */
export async function householdIdsOfChild(ctx: Ctx, childId: string): Promise<string[]> {
  return memo(ctx, `hh:child:${childId}`, async () => {
    const data = await rows(
      dbFor(ctx).from('household_members').select('household_id').eq('person_id', childId).eq('role', 'child'),
    );
    return data.map((r) => String(r.household_id));
  });
}

export async function isParentOf(ctx: Ctx, childId: string): Promise<boolean> {
  const callerId = ctx.callerId;
  if (!callerId) return false;
  const households = await householdIdsOfChild(ctx, childId);
  if (households.length === 0) return false;
  return memo(ctx, `parent:${callerId}:${childId}`, async () => {
    const data = await rows(
      dbFor(ctx)
        .from('household_members')
        .select('household_id')
        .eq('person_id', callerId)
        .in('role', ['parent', 'guardian'])
        .in('household_id', households),
    );
    return data.length > 0;
  });
}

export async function parentIdsOfChild(ctx: Ctx, childId: string): Promise<string[]> {
  const households = await householdIdsOfChild(ctx, childId);
  if (households.length === 0) return [];
  const data = await rows(
    dbFor(ctx)
      .from('household_members')
      .select('person_id')
      .in('role', ['parent', 'guardian'])
      .in('household_id', households),
  );
  return [...new Set(data.map((r) => String(r.person_id)))];
}

/** The caller's own grants for one child. RLS: `actor_id = current_person()` satisfies grants_read. */
export async function ownGrants(ctx: Ctx, childId: string): Promise<GrantRow[]> {
  const callerId = ctx.callerId;
  if (!callerId) return [];
  return memo(ctx, `grants:${callerId}:${childId}`, async () => {
    const data = await rows(
      dbFor(ctx)
        .from('grants')
        .select('id,actor_id,child_id,scopes,valid_from,valid_until,granted_by')
        .eq('actor_id', callerId)
        .eq('child_id', childId),
    );
    return data.map((r) => ({
      id: String(r.id),
      actor_id: String(r.actor_id),
      child_id: String(r.child_id),
      scopes: (r.scopes as string[]) ?? [],
      valid_from: (r.valid_from as string | null) ?? null,
      valid_until: (r.valid_until as string | null) ?? null,
      granted_by: String(r.granted_by),
    }));
  });
}

export async function hasScope(ctx: Ctx, childId: string, scope: string, onDate: string): Promise<boolean> {
  const grants = await ownGrants(ctx, childId);
  return grants.some((g) => g.scopes.includes(scope) && inWindow(g, onDate));
}

export async function hasAnyGrant(ctx: Ctx, childId: string, onDate: string): Promise<boolean> {
  const grants = await ownGrants(ctx, childId);
  return grants.some((g) => inWindow(g, onDate));
}

export type AccessLevel = 'parent' | 'grant' | 'guide';

/**
 * A child whose household is sandbox-visible to the calling guide.
 *
 * Read through the guide's own RLS-scoped client, so the demo_guide_household_members policy (sandbox
 * only) decides the answer. A non-guide never reaches this call.
 */
async function guideCanReadChildImpl(ctx: Ctx, childId: string): Promise<boolean> {
  if (ctx.demoGuide !== true) return false;
  const data = await memo(ctx, `guide:child:${childId}`, async () =>
    rows(
      dbFor(ctx)
        .from('household_members')
        .select('household_id')
        .eq('person_id', childId)
        .eq('role', 'child'),
    ),
  );
  return data.length > 0;
}

/**
 * Public form of the same check, for the subgraphs whose gates are not authorizeChild()
 * (pickup/supervision/approver). Read-only by construction: the demo_guide_* policies decide it.
 */
export async function guideCanReadChild(ctx: Ctx, childId: string): Promise<boolean> {
  return guideCanReadChildImpl(ctx, childId);
}

/** Parents of the child have full access; a guide reads sandbox children; otherwise the field scope. */
export async function authorizeChild(ctx: Ctx, childId: string, scope: string): Promise<AccessLevel> {
  requireCaller(ctx);
  if (await isParentOf(ctx, childId)) return 'parent';
  // Read-only: the guide's level never authorizes a mutation. Every mutation refuses it explicitly
  // (refuseDemoGuideWrite), and the database refuses it again with restrictive policies.
  if (await guideCanReadChild(ctx, childId)) return 'guide';
  if (await hasScope(ctx, childId, scope, ctx.today)) return 'grant';
  throw deny();
}

/** A person row, memoized per request. Used for entity references from other subgraphs. */
export async function personRow(ctx: Ctx, id: string): Promise<Record<string, unknown> | null> {
  return memo(ctx, `person:${id}`, async () =>
    one(dbFor(ctx).from('people').select('id,display_name,birth_date').eq('id', id).maybeSingle()),
  );
}
