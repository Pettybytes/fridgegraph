import { randomUUID } from 'node:crypto';
import { parse } from 'graphql';
import {
  SCOPE,
  authorizeChild,
  deny,
  householdIdsOfChild,
  inWindow,
  isParentOf,
  ownGrants,
  personRow,
  requireCaller,
  type Ctx,
} from '../authz';
import { ageOn } from '../derive';
import { dbFor, one, rows } from '../db';

/**
 * village — Postgres-backed as of B3.
 *
 * Reads go through the caller's RLS-scoped client (src/db.ts): the database decides which rows
 * exist for this caller and this layer decides whether the field is allowed at all.
 * `village` owns people/children/households/relationships/goals/care_plans/groups/memberships.
 */
const typeDefs = parse(`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])


  type Query {
    person(id: ID!): Person
    child(id: ID!): Child
    village(id: ID!): Village
    households(childId: ID!): [Household!]!
    householdMembers(childId: ID!): [HouseholdMember!]!
    relationships(childId: ID!): [Relationship!]!
    contactMethods(personId: ID!, childId: ID): [ContactMethod!]!
    capabilities(personId: ID): [Capability!]!
    groups: [Group!]!
    memberships(groupId: ID): [Membership!]!
    goals(childId: ID!): [Goal!]!
    carePlan(childId: ID!): CarePlan
  }

  type Mutation {
    """DEV SHORTCUT: skips invite + contact verification. Real lifecycle comes later."""
    approveRelationship(relationshipId: ID!): Relationship
  }

  type Person @key(fields: "id") {
    id: ID!
    displayName: String!
    birthDate: String!
    age(asOf: String): Int!
    contactMethods(childId: ID): [ContactMethod!]!
  }

  type Child @key(fields: "id") {
    id: ID!
    person: Person
  }

  type Village {
    id: ID!
    name: String!
  }

  type Household @key(fields: "id") {
    id: ID!
    village: Village
  }

  type HouseholdMember {
    person: Person!
    household: Household!
    role: String!
  }

  type RelationshipEvent {
    at: String!
    event: String!
  }

  type Relationship {
    id: ID!
    from: Person!
    to: Child!
    type: String!
    status: RelationshipStatus!
    createdAt: String!
    history: [RelationshipEvent!]!
  }

  enum RelationshipStatus {
    DISCOVERED
    INTRODUCED
    VERIFIED
    APPROVED
    ACTIVE
    EXPIRED
    REVOKED
  }

  type ContactMethod {
    person: Person!
    channel: ContactChannel!
    value: String!
    preferred: Boolean!
    verified: Boolean!
  }

  enum ContactChannel {
    CALL
    SMS
    EMAIL
  }

  type Capability {
    person: Person!
    name: String!
    conditions: String
  }

  type Group @key(fields: "id") {
    id: ID!
    name: String!
    kind: String!
  }

  type Membership {
    person: Person!
    group: Group!
    role: String!
  }

  type Goal {
    id: ID!
    child: Child!
    title: String!
    owner: Person
    proposedBy: Person
    horizon: String
    status: String!
  }

  type CarePlan {
    child: Child!
    text: String!
  }
`);

type PersonLite = { id: string; displayName?: string; birthDate?: string };
type RelationshipRow = {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  status: string;
  createdAt: string;
  history: Array<{ at: string; event: string }>;
};

const toPerson = (row: Record<string, unknown>): PersonLite => ({
  id: String(row.id),
  displayName: String(row.display_name),
  birthDate: String(row.birth_date).slice(0, 10),
});

const toRelationship = (row: Record<string, unknown>): RelationshipRow => ({
  id: String(row.id),
  fromId: String(row.from_id),
  toId: String(row.to_id),
  type: String(row.type),
  status: String(row.status),
  createdAt: String(row.created_at).slice(0, 10),
  history: ((row.history as Array<{ at: string; event: string }>) ?? []).slice(),
});

/** Entity references from other subgraphs carry only an id; fill from Postgres on demand. */
async function hydratePerson(ctx: Ctx, p: PersonLite): Promise<PersonLite | null> {
  if (p.displayName && p.birthDate) return p;
  const row = await personRow(ctx, p.id);
  return row ? toPerson(row) : null;
}

const resolvers = {
  Query: {
    person: async (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const row = await personRow(ctx, id);
      return row ? toPerson(row) : null;
    },
    child: async (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const row = await one(dbFor(ctx).from('children').select('person_id').eq('person_id', id).maybeSingle());
      return row ? { id: String(row.person_id) } : null;
    },
    village: async (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const row = await one(dbFor(ctx).from('villages').select('id,name').eq('id', id).maybeSingle());
      return row ? { id: String(row.id), name: String(row.name) } : null;
    },
    households: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      if (!(await isParentOf(ctx, childId))) throw deny();
      const ids = await householdIdsOfChild(ctx, childId);
      if (ids.length === 0) return [];
      const data = await rows(dbFor(ctx).from('households').select('id,village_id').in('id', ids));
      return data.map((h) => ({ id: String(h.id), villageId: String(h.village_id) }));
    },
    householdMembers: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      if (!(await isParentOf(ctx, childId))) throw deny();
      const ids = await householdIdsOfChild(ctx, childId);
      if (ids.length === 0) return [];
      const data = await rows(
        dbFor(ctx).from('household_members').select('person_id,household_id,role').in('household_id', ids),
      );
      return data.map((m) => ({
        person: { id: String(m.person_id) },
        household: { id: String(m.household_id) },
        role: String(m.role),
      }));
    },
    relationships: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      if (!(await isParentOf(ctx, childId))) throw deny();
      const data = await rows(
        dbFor(ctx)
          .from('relationships')
          .select('id,from_id,to_id,type,status,created_at,history')
          .eq('to_id', childId),
      );
      return data.map(toRelationship);
    },
    contactMethods: async (
      _: unknown,
      { personId, childId }: { personId: string; childId?: string },
      ctx: Ctx,
    ) => {
      const callerId = requireCaller(ctx);
      if (callerId !== personId) {
        if (!childId) throw deny();
        await authorizeChild(ctx, childId, SCOPE.contacts);
      }
      const data = await rows(
        dbFor(ctx)
          .from('contact_methods')
          .select('person_id,channel,value,preferred,verified')
          .eq('person_id', personId),
      );
      return data.map((c) => ({
        person: { id: String(c.person_id) },
        channel: String(c.channel),
        value: String(c.value),
        preferred: Boolean(c.preferred),
        verified: Boolean(c.verified),
      }));
    },
    capabilities: async (_: unknown, { personId }: { personId?: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const q = dbFor(ctx).from('capabilities').select('person_id,name,conditions');
      const data = await rows(personId ? q.eq('person_id', personId) : q);
      return data.map((c) => ({
        person: { id: String(c.person_id) },
        name: String(c.name),
        conditions: (c.conditions as string | null) ?? null,
      }));
    },
    groups: async (_: unknown, __: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      const data = await rows(dbFor(ctx).from('groups').select('id,name,kind'));
      return data.map((g) => ({ id: String(g.id), name: String(g.name), kind: String(g.kind) }));
    },
    memberships: async (_: unknown, { groupId }: { groupId?: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const q = dbFor(ctx).from('memberships').select('person_id,group_id,role');
      const data = await rows(groupId ? q.eq('group_id', groupId) : q);
      return data.map((m) => ({
        person: { id: String(m.person_id) },
        group: { id: String(m.group_id) },
        role: String(m.role),
      }));
    },
    goals: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const data = await rows(
        dbFor(ctx)
          .from('goals')
          .select('id,child_id,title,owner_id,proposed_by_id,horizon,status')
          .eq('child_id', childId),
      );
      const mapped = data.map((g) => ({
        id: String(g.id),
        child: { id: String(g.child_id) },
        title: String(g.title),
        ownerId: (g.owner_id as string | null) ?? null,
        proposedById: (g.proposed_by_id as string | null) ?? null,
        horizon: (g.horizon as string | null) ?? null,
        status: String(g.status),
      }));
      if (await isParentOf(ctx, childId)) return mapped;
      // A grant holder sees approved goals only; a PROPOSED goal is for parents.
      const grants = await ownGrants(ctx, childId);
      if (grants.some((g) => g.scopes.includes(SCOPE.goals) && inWindow(g, ctx.today))) {
        return mapped.filter((g) => g.status === 'APPROVED');
      }
      throw deny();
    },
    carePlan: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.careplan);
      const row = await one(
        dbFor(ctx).from('care_plans').select('child_id,text').eq('child_id', childId).maybeSingle(),
      );
      return row ? { child: { id: String(row.child_id) }, text: String(row.text) } : null;
    },
  },

  Mutation: {
    approveRelationship: async (
      _: unknown,
      { relationshipId }: { relationshipId: string },
      ctx: Ctx,
    ) => {
      const callerId = requireCaller(ctx);
      const client = dbFor(ctx);

      // Authorization before existence: a caller who is not a parent of any child may not approve
      // anything, whether or not the id exists. RLS alone would return zero rows for both cases
      // and make "denied" indistinguishable from "not found".
      const children = await rows(client.from('children').select('person_id'));
      let anyParent = false;
      for (const c of children) {
        if (await isParentOf(ctx, String(c.person_id))) {
          anyParent = true;
          break;
        }
      }
      if (!anyParent) throw deny();

      const current = await one(
        client
          .from('relationships')
          .select('id,from_id,to_id,type,status,created_at,history')
          .eq('id', relationshipId)
          .maybeSingle(),
      );
      if (!current) return null;

      const history = [
        ...((current.history as Array<{ at: string; event: string }>) ?? []),
        { at: ctx.today, event: 'APPROVED (dev shortcut: invitation and contact verification skipped)' },
      ];

      const updated = await one(
        client
          .from('relationships')
          .update({ status: 'ACTIVE', history })
          .eq('id', relationshipId)
          .select('id,from_id,to_id,type,status,created_at,history')
          .maybeSingle(),
      );
      if (!updated) return null;

      // The audit row lives in `approvals` (access-owned). This is the one documented cross-owner
      // write in the design: an approval is the record OF this village mutation. The RLS policy
      // (`approver_id = current_person()`) permits exactly this and nothing wider.
      const { error } = await client.from('approvals').insert({
        id: `ap_${randomUUID()}`,
        approver_id: callerId,
        subject_type: 'Relationship',
        subject_id: relationshipId,
        decision: 'APPROVED',
        at: ctx.today,
      });
      if (error) {
        console.error('[village.approveRelationship] approval insert failed:', error.code);
        throw new Error('APPROVAL_WRITE_FAILED');
      }

      return toRelationship(updated);
    },
  },

  Person: {
    displayName: async (p: PersonLite, _args: unknown, ctx: Ctx) => {
      const row = await hydratePerson(ctx, p);
      return row?.displayName ?? null;
    },
    birthDate: async (p: PersonLite, _args: unknown, ctx: Ctx) => {
      const row = await hydratePerson(ctx, p);
      return row?.birthDate ?? null;
    },
    age: async (p: PersonLite, { asOf }: { asOf?: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const row = await hydratePerson(ctx, p);
      if (!row?.birthDate) return null;
      return ageOn(row.birthDate, asOf ?? ctx.today);
    },
    contactMethods: async (p: PersonLite, { childId }: { childId?: string }, ctx: Ctx) => {
      const callerId = requireCaller(ctx);
      if (callerId !== p.id) {
        if (!childId) throw deny();
        await authorizeChild(ctx, childId, SCOPE.contacts);
      }
      const data = await rows(
        dbFor(ctx).from('contact_methods').select('person_id,channel,value,preferred,verified').eq('person_id', p.id),
      );
      return data.map((c) => ({
        person: { id: String(c.person_id) },
        channel: String(c.channel),
        value: String(c.value),
        preferred: Boolean(c.preferred),
        verified: Boolean(c.verified),
      }));
    },
  },

  Child: {
    person: (c: { id: string }) => ({ id: c.id }),
  },

  Household: {
    village: async (h: { id: string; villageId?: string }, _args: unknown, ctx: Ctx) => {
      let villageId = h.villageId;
      if (!villageId) {
        const row = await one(dbFor(ctx).from('households').select('village_id').eq('id', h.id).maybeSingle());
        villageId = row ? String(row.village_id) : undefined;
      }
      return villageId ? { id: villageId } : null;
    },
  },

  HouseholdMember: {
    person: (m: { person: { id: string }; personId?: string }) => m.person ?? { id: m.personId },
    household: (m: { household: { id: string }; householdId?: string }) =>
      m.household ?? { id: m.householdId },
  },

  Relationship: {
    from: (r: RelationshipRow) => ({ id: r.fromId }),
    to: (r: RelationshipRow) => ({ id: r.toId }),
  },

  ContactMethod: {
    person: (c: { person: { id: string }; personId?: string }) => c.person ?? { id: c.personId },
  },

  Capability: {
    person: (c: { person: { id: string }; personId?: string }) => c.person ?? { id: c.personId },
  },

  Group: {
    name: async (g: { id: string; name?: string }, _args: unknown, ctx: Ctx) => {
      if (g.name !== undefined) return g.name;
      const row = await one(dbFor(ctx).from('groups').select('name').eq('id', g.id).maybeSingle());
      return row ? String(row.name) : null;
    },
    kind: async (g: { id: string; kind?: string }, _args: unknown, ctx: Ctx) => {
      if (g.kind !== undefined) return g.kind;
      const row = await one(dbFor(ctx).from('groups').select('kind').eq('id', g.id).maybeSingle());
      return row ? String(row.kind) : null;
    },
  },

  Membership: {
    person: (m: { person: { id: string }; personId?: string }) => m.person ?? { id: m.personId },
    group: (m: { group: { id: string }; groupId?: string }) => m.group ?? { id: m.groupId },
  },

  Goal: {
    child: (g: { child: { id: string }; childId?: string }) => g.child ?? { id: g.childId },
    owner: (g: { ownerId: string | null }) => (g.ownerId ? { id: g.ownerId } : null),
    proposedBy: (g: { proposedById: string | null }) => (g.proposedById ? { id: g.proposedById } : null),
  },

  CarePlan: {
    child: (c: { child: { id: string }; childId?: string }) => c.child ?? { id: c.childId },
  },
};

export default { typeDefs, resolvers };
