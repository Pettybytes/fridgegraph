import type { Ctx } from '../authz';
import { parse } from 'graphql';
import {
  SCOPE,
  authorizeChild,
  deny,
  isParentOf,
  requireCaller,
} from '../authz';
import { ageOn } from '../derive';
import { recordApproval, store } from '../store';

const typeDefs = parse(`
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

const personRow = (id: string) => store.people.find((p) => p.id === id);

const resolvers = {
  Query: {
    person: (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      requireCaller(ctx);
      return personRow(id) ?? null;
    },
    child: (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      requireCaller(ctx);
      return store.children.find((c) => c.id === id) ?? null;
    },
    village: (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      requireCaller(ctx);
      return store.villages.find((v) => v.id === id) ?? null;
    },
    households: (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      const callerId = requireCaller(ctx);
      if (!isParentOf(callerId, childId)) throw deny();
      const ids = store.householdMembers
        .filter((m) => m.personId === childId)
        .map((m) => m.householdId);
      return store.households.filter((h) => ids.includes(h.id));
    },
    householdMembers: (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      const callerId = requireCaller(ctx);
      if (!isParentOf(callerId, childId)) throw deny();
      const ids = store.householdMembers
        .filter((m) => m.personId === childId)
        .map((m) => m.householdId);
      return store.householdMembers.filter((m) => ids.includes(m.householdId));
    },
    relationships: (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      const callerId = requireCaller(ctx);
      if (!isParentOf(callerId, childId)) throw deny();
      return store.relationships.filter((r) => r.toId === childId);
    },
    contactMethods: (
      _: unknown,
      { personId, childId }: { personId: string; childId?: string },
      ctx: Ctx,
    ) => {
      const callerId = requireCaller(ctx);
      if (callerId !== personId) {
        if (!childId) throw deny();
        authorizeChild(ctx, childId, SCOPE.contacts);
      }
      return store.contactMethods.filter((c) => c.personId === personId);
    },
    capabilities: (_: unknown, { personId }: { personId?: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const rows = personId
        ? store.capabilities.filter((c) => c.personId === personId)
        : store.capabilities;
      return rows.map((c) => ({ personId: c.personId, name: c.name, conditions: c.conditions }));
    },
    groups: (_: unknown, __: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      return store.groups;
    },
    memberships: (_: unknown, { groupId }: { groupId?: string }, ctx: Ctx) => {
      requireCaller(ctx);
      return groupId
        ? store.memberships.filter((m) => m.groupId === groupId)
        : store.memberships;
    },
    goals: (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      const callerId = requireCaller(ctx);
      const rows = store.goals.filter((g) => g.childId === childId);
      if (isParentOf(callerId, childId)) return rows;
      // A grant holder sees approved goals only; a PROPOSED goal is for parents.
      if (store.grants.some(
        (g) =>
          g.actorId === callerId &&
          g.childId === childId &&
          g.scopes.includes(SCOPE.goals) &&
          (!g.validFrom || ctx.today >= g.validFrom) &&
          (!g.validUntil || ctx.today <= g.validUntil),
      )) {
        return rows.filter((g) => g.status === 'APPROVED');
      }
      throw deny();
    },
    carePlan: (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      authorizeChild(ctx, childId, SCOPE.careplan);
      return store.carePlans.find((c) => c.childId === childId) ?? null;
    },
  },

  Mutation: {
    approveRelationship: (_: unknown, { relationshipId }: { relationshipId: string }, ctx: Ctx) => {
      const callerId = requireCaller(ctx);
      const relationship = store.relationships.find((r) => r.id === relationshipId);
      if (!relationship) return null;
      if (!isParentOf(callerId, relationship.toId)) throw deny();
      relationship.status = 'ACTIVE';
      relationship.history.push({
        at: (ctx as unknown as { today: string }).today,
        event: 'APPROVED (dev shortcut: invitation and contact verification skipped)',
      });
      recordApproval({
        approverId: callerId,
        subjectType: 'Relationship',
        subjectId: relationship.id,
        decision: 'APPROVED',
        at: (ctx as unknown as { today: string }).today,
      });
      return relationship;
    },
  },

  Person: {
    displayName: (p: { id: string }) => personRow(p.id)?.displayName ?? null,
    birthDate: (p: { id: string }) => personRow(p.id)?.birthDate ?? null,
    age: (p: { id: string }, { asOf }: { asOf?: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const row = personRow(p.id);
      if (!row) return null;
      const on = asOf ?? (ctx as unknown as { today: string }).today;
      return ageOn(row.birthDate, on);
    },
    contactMethods: (p: { id: string }, { childId }: { childId?: string }, ctx: Ctx) => {
      const callerId = requireCaller(ctx);
      if (callerId !== p.id) {
        if (!childId) throw deny();
        authorizeChild(ctx, childId, SCOPE.contacts);
      }
      return store.contactMethods.filter((c) => c.personId === p.id);
    },
  },

  Child: {
    person: (c: { id: string }) => ({ id: c.id }),
  },

  Household: {
    village: (h: { villageId?: string; id: string }) => {
      const row = store.households.find((x) => x.id === h.id);
      const villageId = h.villageId ?? row?.villageId;
      return villageId ? { id: villageId } : null;
    },
  },

  HouseholdMember: {
    person: (m: { personId: string }) => ({ id: m.personId }),
    household: (m: { householdId: string }) => ({ id: m.householdId }),
  },

  Relationship: {
    from: (r: { fromId: string }) => ({ id: r.fromId }),
    to: (r: { toId: string }) => ({ id: r.toId }),
  },

  ContactMethod: {
    person: (c: { personId: string }) => ({ id: c.personId }),
  },

  Capability: {
    person: (c: { personId: string }) => ({ id: c.personId }),
  },

  Group: {
    name: (g: { id: string; name?: string }) =>
      g.name ?? store.groups.find((x) => x.id === g.id)?.name ?? null,
    kind: (g: { id: string; kind?: string }) =>
      g.kind ?? store.groups.find((x) => x.id === g.id)?.kind ?? null,
  },

  Membership: {
    person: (m: { personId: string }) => ({ id: m.personId }),
    group: (m: { groupId: string }) => ({ id: m.groupId }),
  },

  Goal: {
    child: (g: { childId: string }) => ({ id: g.childId }),
    owner: (g: { ownerId: string | null }) => (g.ownerId ? { id: g.ownerId } : null),
    proposedBy: (g: { proposedById: string | null }) =>
      g.proposedById ? { id: g.proposedById } : null,
  },

  CarePlan: {
    child: (c: { childId: string }) => ({ id: c.childId }),
  },
};

export default { typeDefs, resolvers };
