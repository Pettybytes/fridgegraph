import { randomUUID } from 'node:crypto';
import { parse } from 'graphql';
import { GraphQLError } from 'graphql';
import {
  SCOPE,
  authorizeChild,
  deny,
  guideCanReadChild,
  isShowcaseGuide,
  hasAnyGrant,
  hasScope,
  isParentOf,
  refuseDemoGuideWrite,
  requireCaller,
  type Ctx,
} from '../authz';
import { approverForChild, pickupCandidatesFor, supervisionCandidatesFor } from '../derive';
import { dbFor, one, rows } from '../db';

/**
 * access — grants, approvals, household policies and parenting schedules.
 *
 * Owns the two mutations that change what a non-parent may see: grantAccess / revokeGrant.
 * `approveRelationship` stays on the village field (it changes a relationship) and writes its
 * single audit row into `approvals`; see HANDOFF §6 for why that one write crosses owners.
 */
const typeDefs = parse(`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])


  type Query {
    grants(childId: ID, actorId: ID): [Grant!]!
    approvals(subjectId: ID): [Approval!]!
    householdPolicy(householdId: ID!): [HouseholdPolicy!]!
    parentingSchedule(childId: ID!): [ParentingSchedule!]!
    pickupCandidates(childId: ID!, asOf: String): [Candidate!]!
    supervisionCandidates(childId: ID!, asOf: String): [Candidate!]!
    approverFor(childId: ID!, date: String): ApproverResult!

    """
    The caller's own children, each with the scopes that caller actually holds for that child.
    A scope grants only what it names: careplan.read never implies schedule reads, pickup or approval.
    """
    myChildren: [ChildAccess!]!

    """
    Completed Add-a-Villager confirmations for this child — sourced from villager_proposals' own
    confirmed_relationship_id/confirmed_grant_id/confirmed_at columns (0074), set exactly once by
    confirm_add_villager itself. Deliberately NOT derived from grants/approvals: those tables
    cannot distinguish a villager addition from an ordinary grantAccess call, and inferring that
    distinction from timing would be a guess, not a stored fact. Caller-scoped by
    villager_proposals' own existing read policy (proposer_id = current_person()) — this read adds
    no new visibility beyond what that policy already allows.
    """
    villagerAdditions(childId: ID!): [VillagerAddition!]!
  }

  type Mutation {
    grantAccess(
      actorId: ID!
      childId: ID!
      scopes: [String!]!
      validFrom: String
      validUntil: String
    ): Grant
    revokeGrant(id: ID!): Boolean!

    """
    Stages a reviewable "Add a Villager" proposal — the Rosina tool this is wired to may call this
    on the parent's behalf, but it never adds anyone by itself. \`personName\` resolves ONLY among
    people who already have some relationship to this exact child (any status) — the same set the
    parent's own \`relationships(childId)\` query already shows them; this never searches a wider
    directory and never creates a new person. \`scopes\` must be a non-empty subset of the scopes
    this flow is allowed to grant (pickup.request, schedule.read) — nothing else, ever, regardless
    of what is asked for.
    """
    proposeAddVillager(
      childId: ID!
      personName: String!
      scopes: [String!]!
      relationshipType: String
      validFrom: String
      validUntil: String
    ): AddVillagerProposal!

    """
    Commits the EXACT reviewed proposal — the relationship and the grant — in one transaction.
    Only the child's authorized parent/guardian may call this, through their own deliberate click.
    Never reachable from Rosina's tool transport (no MCP operation exists for it): a model tool
    call or generated text can never confirm itself. Idempotent: confirming the same proposal
    twice (sequentially or concurrently) returns the SAME result both times. Never makes the
    villager a parent/guardian, and never links the two households.
    """
    confirmAddVillager(proposalId: ID!, version: Int!): AddVillagerResult!
  }

  type Person @key(fields: "id") {
    id: ID!
  }

  type Child @key(fields: "id") {
    id: ID!
  }

  type Household @key(fields: "id") {
    id: ID!
  }


  type ChildAccess {
    child: Child!
    """Exactly the scopes held for THIS child — no inference, no union across children."""
    scopes: [String!]!
  }

  type Grant {
    id: ID!
    actor: Person!
    child: Child!
    scopes: [String!]!
    validFrom: String
    validUntil: String
    grantedBy: Person!
  }

  type Approval {
    id: ID!
    approver: Person!
    subjectType: String!
    subjectId: ID!
    decision: String!
    at: String!
  }

  type HouseholdPolicy {
    household: Household!
    rule: String!
    value: String!
  }

  type ParentingSchedule {
    child: Child!
    parent: Person!
    weekdays: [String!]!
  }

  enum Availability {
    UNKNOWN
    CONTACTED
    CONFIRMED
    DECLINED
  }

  type Candidate {
    person: Person!
    reason: String!
    authorization: String!
    availability: Availability!
  }

  type ApproverResult {
    approver: Person
    fyiParents: [Person!]!
  }

  """A staged, reviewable Add-a-Villager proposal. Writes nothing to relationships or grants
  until confirmed."""
  type AddVillagerProposal {
    id: ID!
    version: Int!
    child: Child!
    person: Person!
    relationshipType: String!
    scopes: [String!]!
    validFrom: String
    validUntil: String
    createdAt: String!
    expiresAt: String!
  }

  """What confirming an Add-a-Villager proposal actually changed."""
  type AddVillagerResult {
    relationship: VillagerRelationship!
    grant: Grant!
  }

  """The relationship half of an Add-a-Villager confirm. Deliberately its own small type, not a
  reference to village's federated Relationship — this echoes what THIS confirm just did; it does
  not make access.ts a second owner of the relationships table's general shape."""
  type VillagerRelationship {
    id: ID!
    from: Person!
    to: Child!
    type: String!
    status: String!
  }

  """A completed Add-a-Villager confirmation. Distinct from AddVillagerProposal, which is the
  staged, unconfirmed draft — this exists only once confirm_add_villager has actually run."""
  type VillagerAddition {
    id: ID!
    child: Child!
    """The villager who was added."""
    person: Person!
    """The parent who confirmed the addition."""
    addedBy: Person!
    relationshipType: String!
    scopes: [String!]!
    confirmedAt: String!
  }
`);

type GrantShape = {
  id: string;
  actorId: string;
  childId: string;
  scopes: string[];
  validFrom: string | null;
  validUntil: string | null;
  grantedBy: string;
};

const toGrant = (row: Record<string, unknown>): GrantShape => ({
  id: String(row.id),
  actorId: String(row.actor_id),
  childId: String(row.child_id),
  scopes: (row.scopes as string[]) ?? [],
  validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : null,
  validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : null,
  grantedBy: String(row.granted_by),
});

const GRANT_COLUMNS = 'id,actor_id,child_id,scopes,valid_from,valid_until,granted_by';

type ProposalShape = {
  id: string;
  version: number;
  childId: string;
  personId: string;
  relationshipType: string;
  scopes: string[];
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
  expiresAt: string;
};

const toProposal = (row: Record<string, unknown>): ProposalShape => ({
  id: String(row.id),
  version: Number(row.version),
  childId: String(row.child_id),
  personId: String(row.person_id),
  relationshipType: String(row.relationship_type),
  scopes: (row.scopes as string[]) ?? [],
  validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : null,
  validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : null,
  createdAt: String(row.created_at),
  expiresAt: String(row.expires_at),
});

type VillagerAdditionShape = {
  id: string;
  childId: string;
  personId: string;
  addedById: string;
  relationshipType: string;
  scopes: string[];
  confirmedAt: string;
};

const toVillagerAddition = (row: Record<string, unknown>): VillagerAdditionShape => ({
  id: String(row.id),
  childId: String(row.child_id),
  personId: String(row.person_id),
  addedById: String(row.proposer_id),
  relationshipType: String(row.relationship_type),
  scopes: (row.scopes as string[]) ?? [],
  confirmedAt: String(row.confirmed_at),
});

/**
 * Maps a `propose_add_villager`/`confirm_add_villager` RPC failure to a clean GraphQLError — same
 * shape as school.ts's `schoolReportProposalError` / coordination.ts's `rpcError`. Message
 * substring matching is the primary signal, exactly like those two; the SQLSTATE fallback below is
 * new here specifically because evidence 65 (docs/evidence/65-teacher-report-live.md) found that,
 * on at least one live deployment, a RAISE EXCEPTION's literal message did not reliably reach this
 * code at all — every refusal surfaced as the generic RPC_FAILED despite the correct SECURITY
 * outcome (refused, nothing written). The SQLSTATE fallback cannot always pick the exact code (two
 * meanings share 42501 and three share 22023 below), but it turns an opaque RPC_FAILED into at
 * least the right CLASS of error rather than none at all. Never trusted as the only signal.
 */
function addVillagerError(e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  const byMessage = [
    'UNAUTHENTICATED', 'DEMO_GUIDE_READ_ONLY', 'UNAUTHORIZED',
    'VILLAGER_SCOPES_REQUIRED', 'VILLAGER_SCOPE_NOT_ALLOWED', 'VILLAGER_NOT_FOUND',
    'VILLAGER_NAME_AMBIGUOUS', 'VILLAGER_RELATIONSHIP_TYPE_NOT_ALLOWED',
    'PROPOSAL_NOT_FOUND', 'PROPOSAL_EXPIRED', 'PROPOSAL_STALE',
  ].find((k) => message.includes(k));
  if (byMessage) throw new GraphQLError(byMessage, { extensions: { code: byMessage } });

  // Documented SQLSTATE fallback — see migration 0074's own "ERRCODE discipline" note for why
  // each code was chosen and which client-facing meanings deliberately collapse together.
  const BY_SQLSTATE: Record<string, string> = {
    '28000': 'UNAUTHENTICATED',
    '42501': 'UNAUTHORIZED', // also covers DEMO_GUIDE_READ_ONLY
    P0002: 'NOT_FOUND', // covers VILLAGER_NOT_FOUND and PROPOSAL_NOT_FOUND alike
    '40001': 'PROPOSAL_STALE',
    '22023': 'VILLAGER_PROPOSAL_INVALID', // scopes/name/relationship-type/expired — see migration
  };
  const sqlstate = (e as { code?: unknown } | null)?.code;
  const byCode = typeof sqlstate === 'string' ? BY_SQLSTATE[sqlstate] : undefined;
  if (byCode) throw new GraphQLError(byCode, { extensions: { code: byCode } });

  const correlationId = randomUUID();
  // Never the message/details/hint fields here — this branch is specifically for an error that
  // matched NEITHER known signal, so those fields cannot be assumed to be this file's own static
  // strings.
  console.error(
    `[access.addVillagerError] unmapped RPC error correlationId=${correlationId} sqlstate=${typeof sqlstate === 'string' ? sqlstate : 'unknown'}`,
  );
  throw new GraphQLError('RPC_FAILED', { extensions: { code: 'RPC_FAILED', correlationId } });
}

/** Writes the audit row for a grant decision. `access` owns `approvals`. */
async function recordApproval(
  ctx: Ctx,
  subjectId: string,
  decision: 'GRANTED' | 'REVOKED',
): Promise<void> {
  const { error } = await dbFor(ctx).from('approvals').insert({
    id: `ap_${randomUUID()}`,
    approver_id: requireCaller(ctx),
    subject_type: 'Grant',
    subject_id: subjectId,
    decision,
    at: ctx.today,
  });
  if (error) {
    console.error('[access] approval insert failed:', error.code);
    throw new Error('APPROVAL_WRITE_FAILED');
  }
}

/** The derived queries need the caller to be a parent or to hold some grant for that child. */
async function requireDerivedAccess(ctx: Ctx, childId: string, onDate: string): Promise<void> {
  requireCaller(ctx);
  if (await isParentOf(ctx, childId)) return;
  // The guide reads sandbox derived data read-only (E2c). Mutations never come through here.
  if (await guideCanReadChild(ctx, childId)) return;
  if (await hasAnyGrant(ctx, childId, onDate)) return;
  throw deny();
}

/**
 * Who may see the pickup candidate list: a parent of the child, or a grant holding pickup.verify.
 * Anyone else is UNAUTHORIZED — an empty list would imply "nobody can collect this child",
 * which is a different and misleading statement.
 */
async function requirePickupAccess(ctx: Ctx, childId: string, onDate: string): Promise<void> {
  requireCaller(ctx);
  if (await isParentOf(ctx, childId)) return;
  // Read-only guide scope over sandbox records (E2c). The list is derived, never a write.
  if (await guideCanReadChild(ctx, childId)) return;
  if (await hasScope(ctx, childId, SCOPE.pickupVerify, onDate)) return;
  throw deny();
}

/** Supervision candidates are for parents only. No new scope is introduced for them. */
async function requireSupervisionAccess(ctx: Ctx, childId: string): Promise<void> {
  requireCaller(ctx);
  if (await isParentOf(ctx, childId)) return;
  if (await guideCanReadChild(ctx, childId)) return;
  throw deny();
}

/**
 * What a guide may see. READ-ONLY by design: no `pickup.request`, no `pickup.verify`, no
 * `supervise.request`. A guide observes sandbox families; it never acts for them.
 */
export const GUIDE_READ_SCOPES: readonly string[] = [
  SCOPE.schedule,
  SCOPE.careplan,
  SCOPE.school,
  SCOPE.contacts,
  SCOPE.transport,
  SCOPE.goals,
] as const;

/**
 * EVERY sandbox child, resolved through the guide's OWN RLS-scoped client so the `demo_guide_*`
 * SELECT policies (0025) decide it. `p_demo_guide` has **no memberships and no grants by design**,
 * so enumeration cannot be derived from the caller's own authority — the reason `myChildren`
 * returned `[]` for the one persona whose job is to see the whole sandbox.
 */
export async function guideChildIds(ctx: Ctx): Promise<string[]> {
  if (!isShowcaseGuide(ctx)) return [];
  const members = await rows(
    dbFor(ctx).from('household_members').select('person_id, role').eq('role', 'child'),
  );
  return [...new Set(members.map((m) => String(m.person_id)))].sort();
}

const resolvers = {
  Query: {
    grants: async (
      _: unknown,
      { childId, actorId }: { childId?: string; actorId?: string },
      ctx: Ctx,
    ) => {
      const callerId = requireCaller(ctx);
      const client = dbFor(ctx);
      if (!childId) {
        // Without a child, only a person's own grants are visible.
        const data = await rows(
          isShowcaseGuide(ctx)
            ? client.from('grants').select(GRANT_COLUMNS)
            : client.from('grants').select(GRANT_COLUMNS).eq('actor_id', callerId),
        );
        return data.map(toGrant);
      }
      if (!(await isParentOf(ctx, childId)) && !(await guideCanReadChild(ctx, childId))) throw deny();
      const q = client.from('grants').select(GRANT_COLUMNS).eq('child_id', childId);
      const data = await rows(actorId ? q.eq('actor_id', actorId) : q);
      return data.map(toGrant);
    },
    approvals: async (_: unknown, { subjectId }: { subjectId?: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const q = dbFor(ctx)
        .from('approvals')
        .select('id,approver_id,subject_type,subject_id,decision,at');
      const data = await rows(subjectId ? q.eq('subject_id', subjectId) : q);
      return data.map((a) => ({
        id: String(a.id),
        approver: { id: String(a.approver_id) },
        subjectType: String(a.subject_type),
        subjectId: String(a.subject_id),
        decision: String(a.decision),
        at: String(a.at).slice(0, 10),
      }));
    },
    householdPolicy: async (_: unknown, { householdId }: { householdId: string }, ctx: Ctx) => {
      const callerId = requireCaller(ctx);
      const members = await rows(
        dbFor(ctx)
          .from('household_members')
          .select('person_id,role')
          .eq('household_id', householdId),
      );
      const childIds = members.filter((m) => m.role === 'child').map((m) => String(m.person_id));
      let anyParent = false;
      for (const childId of childIds) {
        if (await isParentOf(ctx, childId) || await guideCanReadChild(ctx, childId)) {
          anyParent = true;
          break;
        }
      }
      if (!anyParent) throw deny();
      const data = await rows(
        dbFor(ctx)
          .from('household_policies')
          .select('household_id,rule,value')
          .eq('household_id', householdId),
      );
      void callerId;
      return data.map((p) => ({
        household: { id: String(p.household_id) },
        rule: String(p.rule),
        value: String(p.value),
      }));
    },
    parentingSchedule: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.schedule);
      const data = await rows(
        dbFor(ctx)
          .from('parenting_schedules')
          .select('child_id,parent_id,weekdays')
          .eq('child_id', childId),
      );
      return data.map((s) => ({
        child: { id: String(s.child_id) },
        parent: { id: String(s.parent_id) },
        weekdays: (s.weekdays as string[]) ?? [],
      }));
    },
    pickupCandidates: async (
      _: unknown,
      { childId, asOf }: { childId: string; asOf?: string },
      ctx: Ctx,
    ) => {
      const on = asOf ?? ctx.today;
      await requirePickupAccess(ctx, childId, on);
      const candidates = await pickupCandidatesFor(ctx, childId, on);
      return candidates.map((c) => ({
        person: { id: c.personId },
        reason: c.reason,
        authorization: 'AUTHORIZED',
        availability: c.availability,
      }));
    },
    supervisionCandidates: async (
      _: unknown,
      { childId, asOf }: { childId: string; asOf?: string },
      ctx: Ctx,
    ) => {
      const on = asOf ?? ctx.today;
      await requireSupervisionAccess(ctx, childId);
      const candidates = await supervisionCandidatesFor(ctx, childId, on);
      return candidates.map((c) => ({
        person: { id: c.personId },
        reason: c.reason,
        authorization: 'AUTHORIZED',
        availability: c.availability,
      }));
    },
    approverFor: async (
      _: unknown,
      { childId, date }: { childId: string; date?: string },
      ctx: Ctx,
    ) => {
      const on = date ?? ctx.today;
      await requireDerivedAccess(ctx, childId, ctx.today);
      const { approverId, fyiParentIds } = await approverForChild(ctx, childId, on);
      return {
        approver: approverId ? { id: approverId } : null,
        fyiParents: fyiParentIds.map((id) => ({ id })),
      };
    },

    myChildren: async (_: unknown, __: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      const callerId = ctx.callerId!;
      const today = ctx.today;

      // A guide enumerates the sandbox, not its own authority: it holds no memberships and no grants,
      // so the two branches below would return [] for it. Read-only scopes only — the write gates
      // (refuseDemoGuideWrite) are untouched and still refuse the guide.
      if (isShowcaseGuide(ctx)) {
        const ids = await guideChildIds(ctx);
        return ids.map((id) => ({ child: { id }, scopes: [...GUIDE_READ_SCOPES].sort() }));
      }

      // (a) children the caller has authority over, via a parent/guardian membership.
      const memberships = await rows(
        dbFor(ctx).from('household_members').select('household_id,role').eq('person_id', callerId),
      );
      const parentHouseholds = memberships
        .filter((m) => m.role === 'parent' || m.role === 'guardian')
        .map((m) => String(m.household_id));

      const parentChildIds = parentHouseholds.length === 0
        ? []
        : (await rows(
            dbFor(ctx)
              .from('household_members')
              .select('person_id')
              .in('household_id', parentHouseholds)
              .eq('role', 'child'),
          )).map((r) => String(r.person_id));

      // (b) children the caller holds a date-valid grant for. The grant's OWN scopes are reported.
      const grantRows = await rows(
        dbFor(ctx).from('grants').select('child_id,scopes,valid_from,valid_until').eq('actor_id', callerId),
      );
      const granted = new Map<string, Set<string>>();
      for (const g of grantRows) {
        const from = g.valid_from ? String(g.valid_from) : null;
        const until = g.valid_until ? String(g.valid_until) : null;
        const inWindow = (!from || from <= today) && (!until || until >= today);
        if (!inWindow) continue;
        const childId = String(g.child_id);
        const set = granted.get(childId) ?? new Set<string>();
        for (const scope of (g.scopes as string[]) ?? []) set.add(scope);
        granted.set(childId, set);
      }

      const FULL = [
        SCOPE.schedule, SCOPE.careplan, SCOPE.school, SCOPE.contacts,
        SCOPE.transport, SCOPE.goals, SCOPE.pickupVerify, SCOPE.pickupRequest,
      ];

      const out = new Map<string, string[]>();
      for (const childId of new Set([...parentChildIds, ...granted.keys()])) {
        const set = new Set<string>();
        if (parentChildIds.includes(childId)) for (const scope of FULL) set.add(scope);
        for (const scope of granted.get(childId) ?? []) set.add(scope);
        out.set(childId, [...set].sort());
      }

      return [...out.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, scopes]) => ({ child: { id }, scopes }));
    },

    villagerAdditions: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      // No explicit isParentOf check here: villager_proposals' own read policy (proposer_id =
      // current_person()) already fully decides visibility, same posture as the `approvals`
      // query above. Filtering by childId narrows the result; it is not the security boundary.
      const data = await rows(
        dbFor(ctx)
          .from('villager_proposals')
          .select('id,proposer_id,child_id,person_id,relationship_type,scopes,confirmed_at')
          .eq('child_id', childId)
          .not('confirmed_relationship_id', 'is', null),
      );
      return data.map(toVillagerAddition);
    },
  },

  Mutation: {
    grantAccess: async (
      _: unknown,
      {
        actorId,
        childId,
        scopes,
        validFrom,
        validUntil,
      }: { actorId: string; childId: string; scopes: string[]; validFrom?: string; validUntil?: string },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      const callerId = requireCaller(ctx);
      // HouseholdPolicy caregiver_approval = ANY_PARENT: any parent of this child may grant.
      if (!(await isParentOf(ctx, childId))) throw deny();
      const id = `g_${randomUUID()}`;
      const inserted = await one(
        dbFor(ctx)
          .from('grants')
          .insert({
            id,
            actor_id: actorId,
            child_id: childId,
            scopes,
            valid_from: validFrom ?? null,
            valid_until: validUntil ?? null,
            granted_by: callerId,
          })
          .select(GRANT_COLUMNS)
          .maybeSingle(),
      );
      if (!inserted) return null;
      await recordApproval(ctx, id, 'GRANTED');
      return toGrant(inserted);
    },
    revokeGrant: async (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const existing = await one(
        dbFor(ctx).from('grants').select(GRANT_COLUMNS).eq('id', id).maybeSingle(),
      );
      if (!existing) return false;
      if (!(await isParentOf(ctx, String(existing.child_id)))) throw deny();
      const deleted = await rows(dbFor(ctx).from('grants').delete().eq('id', id).select('id'));
      if (deleted.length === 0) return false;
      await recordApproval(ctx, id, 'REVOKED');
      return true;
    },

    proposeAddVillager: async (
      _: unknown,
      {
        childId, personName, scopes, relationshipType, validFrom, validUntil,
      }: {
        childId: string; personName: string; scopes: string[];
        relationshipType?: string; validFrom?: string; validUntil?: string;
      },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const { data, error } = await dbFor(ctx).rpc('propose_add_villager', {
        p_child: childId,
        p_person_name: personName,
        p_scopes: scopes,
        p_relationship_type: relationshipType ?? 'family_friend',
        p_valid_from: validFrom ?? null,
        p_valid_until: validUntil ?? null,
      });
      if (error) addVillagerError(error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
      return toProposal(row);
    },

    confirmAddVillager: async (
      _: unknown,
      { proposalId, version }: { proposalId: string; version: number },
      ctx: Ctx,
    ) => {
      // Rosina's tool transport cannot reach this resolver at all (no MCP operation file exists
      // for it) — this guard is defense in depth, same posture as school.ts's confirm.
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const { data, error } = await dbFor(ctx).rpc('confirm_add_villager', {
        p_proposal: proposalId,
        p_version: version,
      });
      if (error) addVillagerError(error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
      if (!row) throw deny();
      return {
        relationship: {
          id: String(row.relationship_id),
          from: { id: String(row.person_id) },
          to: { id: String(row.child_id) },
          type: String(row.relationship_type),
          status: String(row.relationship_status),
        },
        grant: toGrant({
          id: row.grant_id,
          actor_id: row.person_id,
          child_id: row.child_id,
          scopes: row.scopes,
          valid_from: row.valid_from,
          valid_until: row.valid_until,
          granted_by: row.granted_by,
        }),
      };
    },
  },

  Grant: {
    actor: (g: GrantShape) => ({ id: g.actorId }),
    child: (g: GrantShape) => ({ id: g.childId }),
    grantedBy: (g: GrantShape) => ({ id: g.grantedBy }),
  },

  Approval: {
    approver: (a: { approver: { id: string }; approverId?: string }) =>
      a.approver ?? { id: a.approverId },
  },

  HouseholdPolicy: {
    household: (p: { household: { id: string }; householdId?: string }) =>
      p.household ?? { id: p.householdId },
  },

  ParentingSchedule: {
    child: (s: { child: { id: string }; childId?: string }) => s.child ?? { id: s.childId },
    parent: (s: { parent: { id: string }; parentId?: string }) => s.parent ?? { id: s.parentId },
  },

  AddVillagerProposal: {
    child: (p: ProposalShape) => ({ id: p.childId }),
    person: (p: ProposalShape) => ({ id: p.personId }),
  },

  VillagerRelationship: {
    from: (r: { from: { id: string } }) => r.from,
    to: (r: { to: { id: string } }) => r.to,
  },

  VillagerAddition: {
    child: (v: VillagerAdditionShape) => ({ id: v.childId }),
    person: (v: VillagerAdditionShape) => ({ id: v.personId }),
    addedBy: (v: VillagerAdditionShape) => ({ id: v.addedById }),
  },
};

export default { typeDefs, resolvers };
