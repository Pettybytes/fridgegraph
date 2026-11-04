import { randomUUID } from 'node:crypto';
import { GraphQLError, parse } from 'graphql';
import {
  SCOPE,
  authorizeChild,
  deny,
  householdIdsOfChild,
  inWindow,
  isParentOf,
  guideCanReadChild,
  ownGrants,
  personRow,
  refuseDemoGuideWrite,
  requireCaller,
  type Ctx,
} from '../authz';
import { ageOn, detroitDay } from '../derive';
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

    """
    Fridge notes for this child. Visibility is entirely RLS-governed (fridge_notes_read, 0083): a
    parent/guardian sees every note; the note's own author always sees their own note; anyone
    else sees only notes the author (or a parent) explicitly marked SHARED, and only if they hold
    a fridge.read grant for this child. No code-level filtering beyond that — unlike goals, this
    read needs none.
    """
    fridgeNotes(childId: ID!): [FridgeNote!]!
  }

  type Mutation {
    updateCarePlan(childId: ID!, text: String!): CarePlan!
    """DEV SHORTCUT: skips invite + contact verification. Real lifecycle comes later."""
    approveRelationship(relationshipId: ID!): Relationship

    """
    Set the caller's own shared status, visible to anyone who shares a child's village with
    them. Opt-in text the person chooses; never inferred from Busy/Free. Replaces any existing
    status for the caller. The demo guide is refused.
    """
    setSharedStatus(emoji: String, text: String!, etaText: String, ttlSeconds: Int): SharedStatus!

    """Clears the caller's own shared status, if any. The demo guide is refused."""
    clearSharedStatus: Boolean!

    """
    Parent/guardian only (goals_parent_write, unchanged). \`proposedBy\` is always the caller —
    never a client argument. \`ownerId\` is a free, optional reference (the existing seed shows it
    can be a parent, or null; there is no single correct default).
    """
    createGoal(childId: ID!, title: String!, ownerId: ID, horizon: String, period: GoalPeriod, status: GoalStatus): Goal!

    """
    Content-only edit. Never accepts childId or a proposer reassignment — both are permanently
    immutable once a goal exists (enforced by the goals_guard trigger, 0083), not just omitted
    from this argument list.
    """
    updateGoal(id: ID!, title: String, ownerId: ID, horizon: String, period: GoalPeriod, status: GoalStatus): Goal!

    """Sets completedAt to now(). Independent of status — never changes PROPOSED/APPROVED."""
    completeGoal(id: ID!): Goal!

    """Clears completedAt. Independent of status."""
    uncompleteGoal(id: ID!): Goal!

    """Parent/guardian only."""
    deleteGoal(id: ID!): Boolean!

    """
    Parent/guardian posting, OR a caregiver holding an explicit fridge.post grant for this child —
    household membership alone implies nothing. \`authorId\` is always the caller. Audience
    defaults to PARENTS_ONLY; SHARED must be chosen explicitly.
    """
    postFridgeNote(childId: ID!, text: String!, paperColor: PaperColor, audience: FridgeNoteAudience, attachmentRef: String): FridgeNote!

    """
    Content-only edit (text/paperColor/attachmentRef) by a parent or the note's own author. Never
    accepts audience — see setFridgeNoteAudience. Never accepts childId/authorId: both are
    permanently immutable (fridge_notes_guard trigger, 0083).
    """
    updateFridgeNote(id: ID!, text: String, paperColor: PaperColor, attachmentRef: String): FridgeNote!

    """
    Parent/guardian only — a non-parent author's own edits can never touch audience at all (DB-
    enforced by the same trigger), so there is no separate "unauthorized widening" case to refuse
    here; it is structurally impossible to reach this mutation's write path as anyone else.
    """
    setFridgeNoteAudience(id: ID!, audience: FridgeNoteAudience!): FridgeNote!

    """Parent/guardian only. Not "the author may delete their own note" — that was not asked for."""
    removeFridgeNote(id: ID!): Boolean!
  }

  enum GoalPeriod {
    DAY
    WEEK
    MONTH
  }

  enum GoalStatus {
    PROPOSED
    APPROVED
  }

  enum PaperColor {
    YELLOW
    PINK
    BLUE
    GREEN
    WHITE
  }

  enum FridgeNoteAudience {
    PARENTS_ONLY
    SHARED
  }

  """
  A parent/guardian- or permitted-caregiver-authored note, first slice of the fridge backend
  (docs/contracts/fridge-notes.md). \`revision\` exists for a future conflict-aware client; no
  resolver here compares it — writes are last-write-wins today.
  """
  type FridgeNote {
    id: ID!
    child: Child!
    author: Person!
    text: String!
    paperColor: PaperColor!
    audience: FridgeNoteAudience!
    """No new storage — a reference into whatever store already authorizes/serves it, same shape
    as Orbit's photo_id. Reserved for Rosina's later intake contract; nothing reads it yet."""
    attachmentRef: String
    createdAt: String!
    updatedAt: String!
    revision: Int!
  }

  """
  A status a person CHOOSES to share with a child's village, e.g. "🍼 Changing a diaper · ETA:
  unknown". Opt-in and self-reported only — never derived from Busy/Free, calendar gaps, or any
  other recorded field. Null on the owning \`Person\` when there is no status, it has expired, or
  the viewer may not see that person — the server owns that authorization.
  """
  type SharedStatus {
    personId: ID!
    emoji: String
    text: String!
    etaText: String
    setAt: String!
    expiresAt: String!
  }

  type Person @key(fields: "id") {
    id: ID!
    displayName: String!
    birthDate: String!
    age(asOf: String): Int!
    contactMethods(childId: ID): [ContactMethod!]!
    sharedStatus: SharedStatus
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
    person: VillagePersonRef!
    \"\"\"The RECORDED relationship label, when one exists. Never used to grant authority.\"\"\"
    relationship: String
    \"\"\"Null without address access. Never derived from a schedule or a role.\"\"\"
    homePlaceId: ID
    areaLabel: String
    scheduledEventId: ID
    scheduledPlaceId: ID
  }

  """Only what a world may reveal about a person: no contacts, no grants, no capabilities."""
  type VillagePersonRef {
    id: ID!
    displayName: String!
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
    """Explicitly chosen cadence, additive to horizon — never both required, never inferred."""
    period: GoalPeriod
    """Independent of status. Set only by completeGoal/uncompleteGoal."""
    completedAt: String
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

type GoalShape = {
  id: string;
  childId: string;
  title: string;
  ownerId: string | null;
  proposedById: string | null;
  horizon: string | null;
  status: string;
  period: string | null;
  completedAt: string | null;
};

const GOAL_COLUMNS = 'id,child_id,title,owner_id,proposed_by_id,horizon,status,period,completed_at';

const toGoal = (row: Record<string, unknown>): GoalShape => ({
  id: String(row.id),
  childId: String(row.child_id),
  title: String(row.title),
  ownerId: (row.owner_id as string | null) ?? null,
  proposedById: (row.proposed_by_id as string | null) ?? null,
  horizon: (row.horizon as string | null) ?? null,
  status: String(row.status),
  period: (row.period as string | null) ?? null,
  completedAt: row.completed_at == null ? null : String(row.completed_at),
});

/**
 * Trigger-raised exceptions (goals_guard, fridge_notes_guard — 0083) surface through supabase-js
 * exactly like a RAISE EXCEPTION from a SECURITY DEFINER function: {message, code}. Same
 * message-substring-first, SQLSTATE-fallback shape as access.ts's addVillagerError, scoped to the
 * small set of codes these two triggers can actually raise.
 */
function triggerGuardError(e: unknown, known: readonly string[]): never {
  const message = e instanceof Error ? e.message : String(e);
  const byMessage = known.find((k) => message.includes(k));
  if (byMessage) throw new GraphQLError(byMessage, { extensions: { code: byMessage } });
  const sqlstate = (e as { code?: unknown } | null)?.code;
  if (sqlstate === '42501') throw deny();
  console.error('[village.triggerGuardError] unmapped error:', typeof sqlstate === 'string' ? sqlstate : 'unknown', message);
  throw new GraphQLError('WRITE_FAILED', { extensions: { code: 'WRITE_FAILED' } });
}

const GOAL_ERROR_CODES = ['GOAL_CHILD_IMMUTABLE', 'GOAL_PROPOSER_IMMUTABLE'] as const;
const FRIDGE_NOTE_ERROR_CODES = [
  'FRIDGE_NOTE_CHILD_IMMUTABLE', 'FRIDGE_NOTE_AUTHOR_IMMUTABLE', 'FRIDGE_NOTE_AUDIENCE_LOCKED',
] as const;

type FridgeNoteShape = {
  id: string;
  childId: string;
  authorId: string;
  text: string;
  paperColor: string;
  audience: string;
  attachmentRef: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

const FRIDGE_NOTE_COLUMNS = 'id,child_id,author_id,text,paper_color,audience,attachment_ref,created_at,updated_at,revision';

/** GraphQL enum values are UPPERCASE; the DB's own check constraint is lowercase (0083). */
const PAPER_COLOR_TO_DB: Record<string, string> = { YELLOW: 'yellow', PINK: 'pink', BLUE: 'blue', GREEN: 'green', WHITE: 'white' };
const PAPER_COLOR_FROM_DB: Record<string, string> = { yellow: 'YELLOW', pink: 'PINK', blue: 'BLUE', green: 'GREEN', white: 'WHITE' };

const toFridgeNote = (row: Record<string, unknown>): FridgeNoteShape => ({
  id: String(row.id),
  childId: String(row.child_id),
  authorId: String(row.author_id),
  text: String(row.text),
  paperColor: PAPER_COLOR_FROM_DB[String(row.paper_color)] ?? 'YELLOW',
  audience: String(row.audience),
  attachmentRef: (row.attachment_ref as string | null) ?? null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  revision: Number(row.revision),
});

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

      // Places: ONE read, gated in the database (0075). Labels for anyone with `schedule.read` on
      // this child; coordinates only with address access, and null together otherwise. The source is
      // the curated `recorded_places` catalog (school / practice / park) — never `locations`, whose
      // rows are private home coordinates that feed ride pricing. A home may only appear later as
      // `VillagePerson.homePlaceId`, gated by address access, once a gated home place exists.
      const placeRows = await rows(
        dbFor(ctx).rpc('village_places_for_child', { p_child: childId }),
      );
      // FAIL CLOSED: an empty array is a statement about the family, a database error is not.
      const places = placeRows.map((r) => {
        const state = String(r.state ?? 'absent');
        return {
          id: String(r.id),
          label: r.label == null ? null : String(r.label),
          kind: String(r.kind ?? 'PLACE'),
          lat: r.latitude == null ? null : Number(r.latitude),
          lng: r.longitude == null ? null : Number(r.longitude),
          coordinateState:
            state === 'granted' ? 'SET' : state === 'withheld' ? 'WITHHELD' : 'NOT_RECORDED',
        };
      });

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
        .filter((e) => detroitDay(String(e.start_at)) === day)
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
      if (!(await isParentOf(ctx, childId)) && !(await guideCanReadChild(ctx, childId))) throw deny();
      const ids = await householdIdsOfChild(ctx, childId);
      if (ids.length === 0) return [];
      const data = await rows(dbFor(ctx).from('households').select('id,village_id').in('id', ids));
      return data.map((h) => ({ id: String(h.id), villageId: String(h.village_id) }));
    },
    householdMembers: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      if (!(await isParentOf(ctx, childId)) && !(await guideCanReadChild(ctx, childId))) throw deny();
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
      if (!(await isParentOf(ctx, childId)) && !(await guideCanReadChild(ctx, childId))) throw deny();
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
        dbFor(ctx).from('goals').select(GOAL_COLUMNS).eq('child_id', childId),
      );
      const mapped = data.map(toGoal);
      if (await isParentOf(ctx, childId) || await guideCanReadChild(ctx, childId)) return mapped;
      // A grant holder sees approved goals only; a PROPOSED goal is for parents. Unchanged.
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
    fridgeNotes: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      // No code-level filtering: fridge_notes_read (0083) is the entire visibility rule.
      const data = await rows(
        dbFor(ctx).from('fridge_notes').select(FRIDGE_NOTE_COLUMNS).eq('child_id', childId),
      );
      return data.map(toFridgeNote);
    },
  },

  Mutation: {
    updateCarePlan: async (_: unknown, { childId, text }: { childId: string; text: string }, ctx: Ctx) => {
      requireCaller(ctx);
      refuseDemoGuideWrite(ctx);
      if (!(await isParentOf(ctx, childId))) throw deny();
      if (!text.trim() || text.length > 10000) throw new GraphQLError('INVALID_CARE_PLAN');
      const record = await one(dbFor(ctx).from('care_plans').upsert({ child_id: childId, text: text.trim() }).select('child_id,text').single());
      if (!record) throw deny();
      return { child: { id: childId }, text: record.text };
    },
    approveRelationship: async (
      _: unknown,
      { relationshipId }: { relationshipId: string },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      const callerId = requireCaller(ctx);
      const client = dbFor(ctx);
      if (ctx.demoGuide) {
        const {data,error}=await client.rpc('showcase_approve_relationship',{p_id:relationshipId});
        if(error||!data)throw deny();
        return toRelationship(Array.isArray(data)?data[0]:data);
      }

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

    setSharedStatus: async (
      _: unknown,
      { emoji, text, etaText, ttlSeconds }: { emoji?: string | null; text: string; etaText?: string | null; ttlSeconds?: number | null },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      const callerId = requireCaller(ctx);
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 60) {
        throw new GraphQLError('SHARED_STATUS_TEXT_INVALID', { extensions: { code: 'SHARED_STATUS_TEXT_INVALID' } });
      }
      const ttl = Math.max(ttlSeconds ?? 86_400, 60);
      const setAt = new Date();
      const expiresAt = new Date(setAt.getTime() + ttl * 1000);
      // Upsert, not propose/confirm: a single row per person with no cross-table write, same
      // shape as grantAccess's direct RLS-governed insert — the write policy (0076) is the only
      // thing standing between "the person themselves" and anyone else.
      const row = await one(
        dbFor(ctx)
          .from('shared_statuses')
          .upsert({
            person_id: callerId,
            emoji: emoji ?? null,
            text: trimmed,
            eta_text: etaText ?? null,
            set_at: setAt.toISOString(),
            expires_at: expiresAt.toISOString(),
          }, { onConflict: 'person_id' })
          .select('*')
          .maybeSingle(),
      );
      if (!row) throw new GraphQLError('SHARED_STATUS_WRITE_FAILED', { extensions: { code: 'SHARED_STATUS_WRITE_FAILED' } });
      return {
        personId: String(row.person_id),
        emoji: row.emoji === null ? null : String(row.emoji),
        text: String(row.text),
        etaText: row.eta_text === null ? null : String(row.eta_text),
        setAt: String(row.set_at),
        expiresAt: String(row.expires_at),
      };
    },

    clearSharedStatus: async (_: unknown, _args: unknown, ctx: Ctx) => {
      refuseDemoGuideWrite(ctx);
      const callerId = requireCaller(ctx);
      // Same convention as revokeGrant (access.ts): `rows()` throws the mapped error instead of
      // letting a failed delete silently report success — this previously discarded the
      // {error} Supabase returns and returned `true` unconditionally regardless of outcome.
      await rows(dbFor(ctx).from('shared_statuses').delete().eq('person_id', callerId).select('person_id'));
      return true;
    },

    createGoal: async (
      _: unknown,
      { childId, title, ownerId, horizon, period, status }:
        { childId: string; title: string; ownerId?: string | null; horizon?: string | null; period?: string | null; status?: string | null },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      const callerId = requireCaller(ctx);
      // goals_parent_write (unchanged) enforces is_parent_of(childId) on the insert itself —
      // nothing here duplicates that check; a non-parent's insert is refused by RLS with 0 rows.
      // sandbox: true is asserted explicitly here, never left to the column's own default (which
      // is `false` precisely so an unrelated pre-existing row is never assumed to be demo content
      // — see 0083's own comment). Every goal THIS resolver creates is demo content, full stop.
      const inserted = await one(
        dbFor(ctx)
          .from('goals')
          .insert({
            id: `goal_${randomUUID()}`,
            child_id: childId,
            title,
            owner_id: ownerId ?? null,
            proposed_by_id: callerId,
            horizon: horizon ?? null,
            period: period ?? null,
            status: status ?? 'APPROVED',
            sandbox: true,
          })
          .select(GOAL_COLUMNS)
          .maybeSingle(),
      );
      if (!inserted) throw deny();
      return toGoal(inserted);
    },

    updateGoal: async (
      _: unknown,
      { id, title, ownerId, horizon, period, status }:
        { id: string; title?: string | null; ownerId?: string | null; horizon?: string | null; period?: string | null; status?: string | null },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const patch: Record<string, unknown> = {};
      if (title !== undefined && title !== null) patch.title = title;
      if (ownerId !== undefined) patch.owner_id = ownerId;
      if (horizon !== undefined) patch.horizon = horizon;
      if (period !== undefined) patch.period = period;
      if (status !== undefined && status !== null) patch.status = status;
      // Direct error handling, not one(): this resolver's own patch never sets child_id/
      // proposed_by_id, but a future change to this function must not silently mask
      // goals_guard's specific refusal behind a generic DB_UNAVAILABLE — same defense-in-depth
      // posture as the fridge_notes mutations below, which genuinely can reach their trigger.
      const { data, error } = await dbFor(ctx)
        .from('goals').update(patch).eq('id', id).select(GOAL_COLUMNS).maybeSingle();
      if (error) triggerGuardError(error, GOAL_ERROR_CODES);
      if (!data) throw deny();
      return toGoal(data);
    },

    completeGoal: async (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const updated = await one(
        dbFor(ctx).from('goals').update({ completed_at: new Date().toISOString() }).eq('id', id).select(GOAL_COLUMNS).maybeSingle(),
      );
      if (!updated) throw deny();
      return toGoal(updated);
    },

    uncompleteGoal: async (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const updated = await one(
        dbFor(ctx).from('goals').update({ completed_at: null }).eq('id', id).select(GOAL_COLUMNS).maybeSingle(),
      );
      if (!updated) throw deny();
      return toGoal(updated);
    },

    deleteGoal: async (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const deleted = await rows(dbFor(ctx).from('goals').delete().eq('id', id).select('id'));
      return deleted.length > 0;
    },

    postFridgeNote: async (
      _: unknown,
      { childId, text, paperColor, audience, attachmentRef }:
        { childId: string; text: string; paperColor?: string | null; audience?: string | null; attachmentRef?: string | null },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      const callerId = requireCaller(ctx);
      // fridge_notes_insert (0083) is the entire authorization: is_parent_of(childId) OR an
      // explicit fridge.post grant. Household membership alone grants nothing.
      const { data, error } = await dbFor(ctx)
        .from('fridge_notes')
        .insert({
          id: `fnote_${randomUUID()}`,
          child_id: childId,
          author_id: callerId,
          text,
          paper_color: paperColor ? PAPER_COLOR_TO_DB[paperColor] : undefined,
          audience: audience ?? undefined,
          attachment_ref: attachmentRef ?? null,
        })
        .select(FRIDGE_NOTE_COLUMNS)
        .maybeSingle();
      if (error) triggerGuardError(error, FRIDGE_NOTE_ERROR_CODES);
      if (!data) throw deny();
      return toFridgeNote(data);
    },

    updateFridgeNote: async (
      _: unknown,
      { id, text, paperColor, attachmentRef }:
        { id: string; text?: string | null; paperColor?: string | null; attachmentRef?: string | null },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const patch: Record<string, unknown> = {};
      if (text !== undefined && text !== null) patch.text = text;
      if (paperColor !== undefined && paperColor !== null) patch.paper_color = PAPER_COLOR_TO_DB[paperColor];
      if (attachmentRef !== undefined) patch.attachment_ref = attachmentRef;
      const { data, error } = await dbFor(ctx)
        .from('fridge_notes').update(patch).eq('id', id).select(FRIDGE_NOTE_COLUMNS).maybeSingle();
      if (error) triggerGuardError(error, FRIDGE_NOTE_ERROR_CODES);
      if (!data) throw deny();
      return toFridgeNote(data);
    },

    setFridgeNoteAudience: async (_: unknown, { id, audience }: { id: string; audience: string }, ctx: Ctx) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      // A non-parent author's attempt reaches the trigger (fridge_notes_update's own RLS lets
      // them attempt it) and is refused there with FRIDGE_NOTE_AUDIENCE_LOCKED — not here.
      const { data, error } = await dbFor(ctx)
        .from('fridge_notes').update({ audience }).eq('id', id).select(FRIDGE_NOTE_COLUMNS).maybeSingle();
      if (error) triggerGuardError(error, FRIDGE_NOTE_ERROR_CODES);
      if (!data) throw deny();
      return toFridgeNote(data);
    },

    removeFridgeNote: async (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const deleted = await rows(dbFor(ctx).from('fridge_notes').delete().eq('id', id).select('id'));
      return deleted.length > 0;
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
    sharedStatus: async (p: PersonLite, _args: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      // RLS alone decides both visibility AND expiry (shared_statuses_read, 0076) — no app-level
      // check of either here, same "no oracle" shape as every other RLS-governed read in this
      // file. "No status", "expired", and "may not see this person" are all indistinguishable
      // zero-row results, which is the point: a caller can't tell which of the three it is.
      const data = await rows(
        dbFor(ctx).from('shared_statuses').select('*').eq('person_id', p.id),
      );
      const row = data[0];
      if (!row) return null;
      return {
        personId: String(row.person_id),
        emoji: row.emoji === null ? null : String(row.emoji),
        text: String(row.text),
        etaText: row.eta_text === null ? null : String(row.eta_text),
        setAt: String(row.set_at),
        expiresAt: String(row.expires_at),
      };
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

  FridgeNote: {
    child: (n: FridgeNoteShape) => ({ id: n.childId }),
    author: (n: FridgeNoteShape) => ({ id: n.authorId }),
  },
};

export default { typeDefs, resolvers };
