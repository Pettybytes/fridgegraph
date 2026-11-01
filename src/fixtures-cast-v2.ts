/**
 * Cast v2 — the six demo networks, additive to the existing baseline.
 *
 * Networks: Ellison (existing), Coleman (existing), Castellano (Emma; guardians Rosa & Tomás),
 * Vance–Reyes (Taylor, Skye; stepdad Marcus as a resident adult), Lee (Simone & Denise, Micah, Avery),
 * Ferris (Dwayne, Malik; aunt Cassandra; neighbour Oscar; Priya).
 *
 * RULES
 * - Additive only: no existing baseline row is modified, no existing grant is revoked.
 * - Fictional data only; phone numbers use the unreachable 555-01xx range; emails are example.com.
 * - Dana is absent from every generated history and event: she has no record here at all.
 * - Everything with a `sandbox` column is sandbox=true.
 */

export type CastV2 = {
  villages: { id: string; name: string }[];
  people: { id: string; display_name: string; birth_date: string }[];
  children: { person_id: string }[];
  households: { id: string; village_id: string }[];
  household_members: { person_id: string; household_id: string; role: string }[];
  relationships: { id: string; from_id: string; to_id: string; type: string; status: string; created_at: string; history: unknown[] }[];
  contact_methods: { person_id: string; channel: string; value: string; preferred: boolean; verified: boolean }[];
  grants: { id: string; actor_id: string; child_id: string; scopes: string[]; valid_from: string | null; valid_until: string | null; granted_by: string }[];
  routines: { id: string; child_id: string; title: string; weekdays: string[]; start_time: string; end_time: string; location: string | null; sandbox: boolean }[];
  events: { id: string; child_id: string; title: string; start_at: string; end_at: string; location: string | null; status: string }[];
  care_facts: Record<string, unknown>[];
};

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

/** Historical window: 2026-09-01 .. 2026-10-29. Upcoming: 2026-11-01 .. 2026-11-30. */
function dayString(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const SCHOOL_DAYS = weekdaysBetween('2026-09-01', '2026-10-29');

/** One activity per child per week, deterministic by index. Rotates three stories. */
const STORIES = [
  { title: 'Soccer practice', location: 'Field 2', time: '16:00' },
  { title: 'Piano lesson', location: 'Music room', time: '17:00' },
  { title: 'Library club', location: 'Public library', time: '15:30' },
];

const CHILDREN = ['p_nora', 'p_jax', 'p_emma', 'p_taylor', 'p_skye', 'p_micah', 'p_avery', 'p_malik'];

export function createCastV2(): CastV2 {
  const people = [
    { id: 'p_rosa', display_name: 'Rosa Castellano', birth_date: '1962-02-11' },
    { id: 'p_tomas', display_name: 'Tomás Castellano', birth_date: '1960-08-23' },
    { id: 'p_emma', display_name: 'Emma Castellano', birth_date: '2017-11-04' },
    { id: 'p_felicia', display_name: 'Felicia Reyes', birth_date: '1989-06-15' },
    { id: 'p_taylor', display_name: 'Taylor Reyes', birth_date: '2016-09-02' },
    { id: 'p_skye', display_name: 'Skye Reyes', birth_date: '2019-04-19' },
    { id: 'p_simone', display_name: 'Simone Lee', birth_date: '1987-12-07' },
    { id: 'p_denise', display_name: 'Denise Lee', birth_date: '1989-03-28' },
    { id: 'p_micah', display_name: 'Micah Lee', birth_date: '2016-01-16' },
    { id: 'p_avery', display_name: 'Avery Lee', birth_date: '2019-10-08' },
    { id: 'p_dwayne', display_name: 'Dwayne Ferris', birth_date: '1985-07-03' },
    { id: 'p_malik', display_name: 'Malik Ferris', birth_date: '2017-05-21' },
    { id: 'p_cassandra', display_name: 'Cassandra Ferris', birth_date: '1992-01-30' },
    { id: 'p_oscar', display_name: 'Oscar Alvarez', birth_date: '1978-11-12' },
    // Nora's teacher (TASK: teacher persona). Additive to the Ellison network like everything
    // else here — no existing Ellison person, relationship or grant is touched.
    { id: 'p_whitfield', display_name: 'Ms. Whitfield', birth_date: '1984-04-02' },
  ];

  const villages = [
    { id: 'v_emma', name: "Emma's village" },
    { id: 'v_taylor', name: "Taylor's village" },
    { id: 'v_micah', name: "Micah's village" },
    { id: 'v_malik', name: "Malik's village" },
  ];

  const households = [
    { id: 'h_emma', village_id: 'v_emma' },
    { id: 'h_taylor', village_id: 'v_taylor' },
    { id: 'h_micah', village_id: 'v_micah' },
    { id: 'h_malik', village_id: 'v_malik' },
  ];

  const household_members = [
    { person_id: 'p_rosa', household_id: 'h_emma', role: 'parent' },
    { person_id: 'p_tomas', household_id: 'h_emma', role: 'parent' },
    { person_id: 'p_emma', household_id: 'h_emma', role: 'child' },
    { person_id: 'p_felicia', household_id: 'h_taylor', role: 'parent' },
    { person_id: 'p_marcus', household_id: 'h_taylor', role: 'resident_adult' },
    { person_id: 'p_taylor', household_id: 'h_taylor', role: 'child' },
    { person_id: 'p_skye', household_id: 'h_taylor', role: 'child' },
    { person_id: 'p_simone', household_id: 'h_micah', role: 'parent' },
    { person_id: 'p_denise', household_id: 'h_micah', role: 'parent' },
    { person_id: 'p_micah', household_id: 'h_micah', role: 'child' },
    { person_id: 'p_avery', household_id: 'h_micah', role: 'child' },
    { person_id: 'p_dwayne', household_id: 'h_malik', role: 'parent' },
    { person_id: 'p_malik', household_id: 'h_malik', role: 'child' },
  ];

  const rel = (id: string, from: string, to: string, type: string, day = '2026-08-15') => ({
    id, from_id: from, to_id: to, type, status: 'ACTIVE', created_at: day, history: [],
  });

  const relationships = [
    rel('r_rosa_emma', 'p_rosa', 'p_emma', 'guardian'),
    rel('r_tomas_emma', 'p_tomas', 'p_emma', 'guardian'),
    rel('r_felicia_taylor', 'p_felicia', 'p_taylor', 'guardian'),
    rel('r_felicia_skye', 'p_felicia', 'p_skye', 'guardian'),
    rel('r_marcus_taylor', 'p_marcus', 'p_taylor', 'step_parent'),
    rel('r_marcus_skye', 'p_marcus', 'p_skye', 'step_parent'),
    rel('r_simone_micah', 'p_simone', 'p_micah', 'guardian'),
    rel('r_simone_avery', 'p_simone', 'p_avery', 'guardian'),
    rel('r_denise_micah', 'p_denise', 'p_micah', 'guardian'),
    rel('r_denise_avery', 'p_denise', 'p_avery', 'guardian'),
    rel('r_dwayne_malik', 'p_dwayne', 'p_malik', 'guardian'),
    rel('r_cassandra_malik', 'p_cassandra', 'p_malik', 'aunt'),
    rel('r_oscar_malik', 'p_oscar', 'p_malik', 'neighbor'),
    rel('r_priya_malik', 'p_priya', 'p_malik', 'nanny'),
    rel('r_whitfield_teacher', 'p_whitfield', 'p_nora', 'teacher'),
  ];

  const contact = (person: string, channel: string, value: string) => ({ person_id: person, channel, value, preferred: true, verified: true });
  const contact_methods = [
    contact('p_rosa', 'SMS', '+1-313-555-0201'),
    contact('p_tomas', 'SMS', '+1-313-555-0202'),
    contact('p_felicia', 'SMS', '+1-313-555-0203'),
    contact('p_simone', 'SMS', '+1-313-555-0204'),
    contact('p_denise', 'SMS', '+1-313-555-0205'),
    contact('p_dwayne', 'SMS', '+1-313-555-0206'),
    contact('p_cassandra', 'SMS', '+1-313-555-0207'),
    contact('p_oscar', 'SMS', '+1-313-555-0208'),
  ];

  // Priya's Malik grant is ADDITIVE. Her existing Nora grant is baseline and is not touched.
  const grants = [
    { id: 'g_priya_malik', actor_id: 'p_priya', child_id: 'p_malik', scopes: ['careplan.read'], valid_from: null, valid_until: null, granted_by: 'p_dwayne' },
    { id: 'g_rosa_emma', actor_id: 'p_rosa', child_id: 'p_emma', scopes: ['schedule.read', 'careplan.read'], valid_from: null, valid_until: null, granted_by: 'p_rosa' },
    { id: 'g_tomas_emma', actor_id: 'p_tomas', child_id: 'p_emma', scopes: ['schedule.read', 'careplan.read'], valid_from: null, valid_until: null, granted_by: 'p_rosa' },
    // Ms. Whitfield (TASK: teacher persona): school-day read + the new school.report write only.
    // No careplan.read, no pickup.*, no transport.*, no contacts.* — nothing beyond the school
    // subgraph for exactly one child. Granted by Kendra, the same as every other Nora-side grant.
    { id: 'g_whitfield_school', actor_id: 'p_whitfield', child_id: 'p_nora', scopes: ['school.read', 'school.report'], valid_from: null, valid_until: null, granted_by: 'p_mom' },
  ];

  // 24 routines: four per network across the six networks (Ellison/Coleman get theirs here too).
  const routineSpec = [
    ['School run', '07:30', '08:15', 'School'],
    ['Homework', '16:30', '17:15', 'Home'],
    ['Dinner', '18:00', '18:45', 'Home'],
    ['Bedtime routine', '19:30', '20:15', 'Home'],
  ] as const;
  const routines: CastV2['routines'] = [];
  const routineChildren = [...CHILDREN];
  routineChildren.forEach((child, i) => {
    routineSpec.forEach(([title, start, end, location], j) => {
      routines.push({
        id: `fx_routine_${child}_${j}`,
        child_id: child,
        title: `${title}`,
        weekdays: WEEKDAYS,
        start_time: start,
        end_time: end,
        location,
        sandbox: true,
      });
    });
  });

  // Historical events: 9 per child = 72, spread across the school days; three connected stories.
  const events: CastV2['events'] = [];
  CHILDREN.forEach((child, ci) => {
    for (let k = 0; k < 9; k += 1) {
      const day = SCHOOL_DAYS[(ci * 7 + k * 5) % SCHOOL_DAYS.length];
      const story = STORIES[(ci + k) % STORIES.length];
      const isSchool = k % 3 === 0;
      events.push({
        id: `fx_event_${child}_${k}`,
        child_id: child,
        title: isSchool ? 'School day' : story.title,
        start_at: `${day}T${isSchool ? '08:15' : story.time}:00`,
        end_at: `${day}T${isSchool ? '15:00' : story.time.replace(':00', ':45')}:00`,
        location: isSchool ? 'Lincoln Elementary' : story.location,
        status: 'confirmed',
      });
    }
  });

  // Upcoming: 2 per child = 16, November 2026.
  const upcomingDays = ['2026-11-04', '2026-11-18'];
  CHILDREN.forEach((child, ci) => {
    upcomingDays.forEach((day, k) => {
      const story = STORIES[(ci + k) % STORIES.length];
      events.push({
        id: `fx_upcoming_${child}_${k}`,
        child_id: child,
        title: k === 0 ? 'Parent-teacher conference' : story.title,
        start_at: `${day}T${k === 0 ? '16:00' : story.time}:00`,
        end_at: `${day}T${k === 0 ? '16:30' : story.time.replace(':00', ':45')}:00`,
        location: k === 0 ? 'Lincoln Elementary' : story.location,
        status: 'confirmed',
      });
    });
  });

  const care_facts = [
    {
      id: 'fx_cf_malik_snack', child_id: 'p_malik', key: 'snack',
      value: 'No peanut butter — peanut-free snacks only, no shared utensils',
      source_kind: 'PARENT_CONVERSATION', source_ref: 'Dwayne, care conversation 2026-10-20',
      verified_by: 'p_dwayne', verified_at: '2026-10-20T17:00:00Z', confidence: 'CONFIRMED',
      sandbox: true, fixture: true,
    },
    {
      id: 'fx_cf_malik_tv', child_id: 'p_malik', key: 'tv',
      value: '20 minutes after homework; no screens after 7:30pm',
      source_kind: 'PARENT_CONVERSATION', source_ref: 'Dwayne, care conversation 2026-10-20',
      verified_by: 'p_dwayne', verified_at: '2026-10-20T17:00:00Z', confidence: 'CONFIRMED',
      sandbox: true, fixture: true,
    },
    {
      id: 'fx_cf_malik_bedtime', child_id: 'p_malik', key: 'bedtime',
      value: 'Lights out 8:00pm on school nights',
      source_kind: 'PARENT_CONVERSATION', source_ref: 'Dwayne, care conversation 2026-10-20',
      verified_by: 'p_dwayne', verified_at: '2026-10-20T17:00:00Z', confidence: 'CONFIRMED',
      sandbox: true, fixture: true,
    },
  ];

  console.log(`[cast-v2] ${villages.length} villages, ${people.length} people, ${routines.length} routines, ${events.length} events`);

  return {
    villages,
    people,
    children: people.filter((p) => CHILDREN.includes(p.id)).map((p) => ({ person_id: p.id })),
    households,
    household_members,
    relationships,
    contact_methods,
    grants,
    routines,
    events,
    care_facts,
  };
}
