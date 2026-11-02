import { randomUUID } from 'node:crypto';
import { GraphQLError, parse } from 'graphql';
import {
  SCOPE,
  authorizeChild,
  deny,
  householdIdsOfChild,
  inWindow,
  isParentOf,
  ownGrants,
  personRow,
  refuseDemoGuideWrite,
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
    """
    The authorized village for one child on one day, shaped for the map. One gate
    (\`schedule.read\` on that child) covers the whole world; a child the caller cannot read is
    refused generically, never answered with an empty village that reveals it exists.
    """
    villageWorld(childId: ID!, asOf: String): VillageWorld!
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

  type VillageWorld {
    village: Village
    child: Child!
    people: [VillagePerson!]!
    places: [VillagePlace!]!
    events: [VillageDayEvent!]!
  }

  \"\"\"An adult the caller may see in this child's world.\"\"\"
  type VillagePerson {
    person: Person!
    \"\"\"The RECORDED relationship label, when one exists. Never used to grant authority.\"\"\"
    relationship: String
    \"\"\"Null without address access. Never derived from a schedule or a role.\"\"\"
    homePlaceId: ID
    areaLabel: String
    scheduledEventId: ID
    scheduledPlaceId: ID
  }

  type VillagePlace {
    id: ID!
    label: String
    kind: String!
    lat: Float
    lng: Float
    coordinateState: CoordinateState!
  }

  enum CoordinateState {
    SET
    WITHHELD
    NOT_RECORDED
  }

  type VillageDayEvent {
    id: ID!
    title: String!
    start: String!
    end: String
    status: String
    placeId: ID
    placeState: PlaceState!
    personIds: [ID!]!
  }

  enum PlaceState {
    LINKED
    UNLINKED
    WITHHELD
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
    villageWorld: async (
      _: unknown,
      { childId, asOf }: { childId: string; asOf?: string | null },
      ctx: Ctx,
    ) => {
      requireCaller(ctx);
      // ONE gate for the whole world. A child the caller cannot read is refused generically — an
      // empty village would still tell them the child exists.
      await authorizeChild(ctx, childId, SCOPE.schedule);

      const day = asOf ?? ctx.today;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        throw new GraphQLError('INVALID_DAY', { extensions: { code: 'INVALID_DAY' } });
      }

      const households = await householdIdsOfChild(ctx, childId);
      const householdId = households[0] ?? null;

      let village: { id: string; name: string } | null = null;
      if (householdId) {
        const h = await one(dbFor(ctx).from('households').select('village_id').eq('id', householdId).maybeSingle());
        const villageId = h?.village_id ? String(h.village_id) : null;
        if (villageId) {
          const v = await one(dbFor(ctx).from('villages').select('id,name').eq('id', villageId).maybeSingle());
          if (v) village = { id: String(v.id), name: String(v.name) };
        }
      }

      // People: household adults, people with a RECORDED relationship to the child, and grant actors.
      // A household-row role is a fact about the household, never an authority or a position.
      const peopleIds = new Set<string>();
      if (householdId) {
        const members = await rows(
          dbFor(ctx).from('household_members').select('person_id,role').eq('household_id', householdId),
        );
        for (const m of members) if (String(m.role) !== 'child') peopleIds.add(String(m.person_id));
      }
      const rels = await rows(
        dbFor(ctx).from('relationships').select('from_id,type,status').eq('to_id', childId),
      );
      for (const r of rels) peopleIds.add(String(r.from_id));
      const grantRows = await rows(dbFor(ctx).from('grants').select('actor_id').eq('child_id', childId));
      for (const g of grantRows) peopleIds.add(String(g.actor_id));

      const people: Array<Record<string, unknown>> = [];
      for (const id of peopleIds) {
        const p = await personRow(ctx, id);
        if (!p) continue;
        const rel = rels.find((r) => String(r.from_id) === id);
        people.push({
          person: { id, displayName: String(p.display_name) },
          relationship: rel?.type == null ? null : String(rel.type),
          // Not derived: a home is a private address and needs the address gate, and an event link
          // is a place association the caller must be able to see. Null means "not stated", never "unknown user".
          homePlaceId: null,
          areaLabel: null,
          scheduledEventId: null,
          scheduledPlaceId: null,
        });
      }

      // Places: every candidate is re-authorized by the database through place_route_geometry_for,
      // which decides visibility and coordinate release for THIS child and THIS caller. A refusal is
      // skipped rather than widened: the map simply has no pin for it.
      const placeIds = new Set<string>();
      const childPlaces = await rows(
        dbFor(ctx).from('locations').select('id').eq('owner_type', 'CHILD').eq('owner_id', childId),
      );
      for (const l of childPlaces) placeIds.add(String(l.id));
      if (peopleIds.size > 0) {
        const personPlaces = await rows(
          dbFor(ctx).from('locations').select('id').eq('owner_type', 'PERSON').in('owner_id', [...peopleIds]),
        );
        for (const l of personPlaces) placeIds.add(String(l.id));
      }

      const places: Array<Record<string, unknown>> = [];
      for (const placeId of placeIds) {
        const { data, error } = await dbFor(ctx).rpc('place_route_geometry_for', {
          p_child: childId,
          p_place: placeId,
        });
        if (error) continue;
        const row = (Array.isArray(data) ? data[0] : data) as
          | { id?: string; label?: string | null; state?: string; latitude?: number | null; longitude?: number | null }
          | null;
        if (!row?.id) continue;
        const state = String(row.state ?? 'absent');
        places.push({
          id: String(row.id),
          label: row.label == null ? null : String(row.label),
          // The place catalog carries no kind column yet; the field exists so the adapter does not
          // need a wire break when it does. It is NOT a guess about what the place is.
          kind: 'PLACE',
          lat: row.latitude == null ? null : Number(row.latitude),
          lng: row.longitude == null ? null : Number(row.longitude),
          coordinateState:
            state === 'granted' ? 'SET' : state === 'withheld' ? 'WITHHELD' : 'NOT_RECORDED',
        });
      }

      // The selected day's events. `placeState` distinguishes "no place recorded" from "place
      // withheld", so the UI never has to guess which one it is looking at.
      const eventRows = await rows(
        dbFor(ctx)
          .from('events')
          .select('id,title,start_at,end_at,status,place_id,child_id')
          .eq('child_id', childId),
      );
      const visiblePlaceIds = new Set(places.map((p) => String(p.id)));
      const events = eventRows
        .filter((e) => String(e.start_at).slice(0, 10) === day)
        .map((e) => {
          const placeId = e.place_id == null ? null : String(e.place_id);
          const linked = placeId !== null && visiblePlaceIds.has(placeId);
          return {
            id: String(e.id),
            title: String(e.title),
            start: String(e.start_at),
            end: e.end_at == null ? null : String(e.end_at),
            status: e.status == null ? null : String(e.status),
            placeId: linked ? placeId : null,
            placeState: placeId === null ? 'UNLINKED' : linked ? 'LINKED' : 'WITHHELD',
            // Participants are not derived yet rather than inferred from a title or a schedule.
            personIds: [] as string[],
          };
        });

      return { village, child: { id: childId }, people, places, events };
    },
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
      refuseDemoGuideWrite(ctx);
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
