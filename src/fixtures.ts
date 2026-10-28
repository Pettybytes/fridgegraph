/**
 * FridgeGraph fictional fixtures.
 *
 * Every person here is fictional. Contact values use only the reserved +1-313-555-01xx range and
 * name@example.com. Licence plates use only the reserved DEMO-### form. Nothing in this file is
 * real data and nothing here may be replaced with real data.
 *
 * One record per person, even when a person holds several relationships (e.g. Tasha is both
 * "aunt" and "godmother" — two Relationship rows, one Person).
 */

export type PersonRow = { id: string; displayName: string; birthDate: string };
export type RelationshipRow = {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  status: string;
  createdAt: string;
  history: { at: string; event: string }[];
};
export type ContactRow = {
  personId: string;
  channel: 'CALL' | 'SMS' | 'EMAIL';
  value: string;
  preferred: boolean;
  verified: boolean;
};

export type Seed = {
  people: PersonRow[];
  children: { id: string }[];
  villages: { id: string; name: string }[];
  households: { id: string; villageId: string }[];
  householdMembers: { personId: string; householdId: string; role: string }[];
  relationships: RelationshipRow[];
  contactMethods: ContactRow[];
  capabilities: { personId: string; name: string; conditions: string | null }[];
  groups: { id: string; name: string; kind: string }[];
  memberships: { personId: string; groupId: string; role: string }[];
  goals: {
    id: string;
    childId: string;
    title: string;
    ownerId: string | null;
    proposedById: string | null;
    horizon: string | null;
    status: string;
  }[];
  carePlans: { childId: string; text: string }[];
  grants: {
    id: string;
    actorId: string;
    childId: string;
    scopes: string[];
    validFrom: string | null;
    validUntil: string | null;
    grantedBy: string;
  }[];
  approvals: {
    id: string;
    approverId: string;
    subjectType: string;
    subjectId: string;
    decision: string;
    at: string;
  }[];
  policies: { householdId: string; rule: string; value: string }[];
  schedules: { childId: string; parentId: string; weekdays: string[] }[];
  events: { id: string; childId: string; title: string; start: string; end: string; location: string }[];
  busRosters: { date: string; childId: string; route: string; riding: boolean }[];
  vehicles: {
    id: string;
    ownerId: string;
    year: number;
    make: string;
    model: string;
    color: string;
    plate: string;
  }[];
  practices: { id: string; groupId: string; start: string; location: string }[];
  schoolReports: { id: string; childId: string; kind: string; text: string; at: string }[];
  permissionSlips: { id: string; childId: string; title: string; signed: boolean }[];
  coordinationJobs: {
    id: string;
    idempotencyKey: string;
    type: string;
    childId: string;
    status: string;
    version: number;
  }[];
  attempts: { id: string; jobId: string; channel: string; at: string }[];
  informationRequests: { id: string; jobId: string; question: string; status: string }[];
  confirmations: { id: string; jobId: string; receivedAt: string }[];
};

export function createSeed(): Seed {
  const people: PersonRow[] = [
    // Nora's village
    { id: 'p_nora', displayName: 'Nora Ellison', birthDate: '2018-03-14' },
    { id: 'p_mom', displayName: 'Kendra Ellison', birthDate: '1988-05-02' },
    { id: 'p_dad', displayName: 'Andre Ellison', birthDate: '1986-09-20' },
    { id: 'p_leo', displayName: 'Leo Ellison', birthDate: '2010-10-29' },
    { id: 'p_max', displayName: 'Max Ellison', birthDate: '2013-06-02' },
    { id: 'p_gma', displayName: 'Loretta Brooks', birthDate: '1957-11-08' },
    { id: 'p_bryan', displayName: 'Bryan Brooks', birthDate: '1984-01-30' },
    { id: 'p_walter', displayName: 'Walter Ellison', birthDate: '1955-04-22' },
    { id: 'p_gloria', displayName: 'Gloria Ellison', birthDate: '1958-12-09' },
    { id: 'p_tasha', displayName: 'Tasha Ellison', birthDate: '1990-02-17' },
    { id: 'p_monique', displayName: 'Monique Davis', birthDate: '1987-07-30' },
    { id: 'p_chris', displayName: 'Chris Harlan', birthDate: '1985-03-11' },
    { id: 'p_priya', displayName: 'Priya Nair', birthDate: '2003-09-05' },
    // School and activities — shared, belong to no village
    { id: 'p_price', displayName: 'Angela Price', birthDate: '1982-01-19' },
    { id: 'p_okafor', displayName: 'Daniel Okafor', birthDate: '1991-06-27' },
    { id: 'p_jennings', displayName: 'Carol Jennings', birthDate: '1975-10-03' },
    { id: 'p_holt', displayName: 'Gary Holt', birthDate: '1968-02-14' },
    { id: 'p_marcus', displayName: 'Marcus Reyes', birthDate: '1979-08-05' },
    // Jax's village
    { id: 'p_jax', displayName: 'Jax Coleman', birthDate: '2018-07-21' },
    { id: 'p_dana', displayName: 'Dana Coleman', birthDate: '1987-04-11' },
    { id: 'p_ray', displayName: 'Ray Coleman', birthDate: '1985-12-03' },
    { id: 'p_evelyn', displayName: 'Evelyn Carter', birthDate: '1960-05-16' },
  ];

  const children = [{ id: 'p_nora' }, { id: 'p_jax' }];

  const villages = [
    { id: 'v_nora', name: "Nora's village" },
    { id: 'v_jax', name: "Jax's village" },
  ];

  const households = [
    { id: 'h_a', villageId: 'v_nora' },
    { id: 'h_b', villageId: 'v_nora' },
    { id: 'h_c', villageId: 'v_jax' },
    { id: 'h_d', villageId: 'v_jax' },
  ];

  const householdMembers = [
    { personId: 'p_mom', householdId: 'h_a', role: 'parent' },
    { personId: 'p_leo', householdId: 'h_a', role: 'child' },
    { personId: 'p_max', householdId: 'h_a', role: 'child' },
    { personId: 'p_nora', householdId: 'h_a', role: 'child' },
    { personId: 'p_dad', householdId: 'h_b', role: 'parent' },
    { personId: 'p_nora', householdId: 'h_b', role: 'child' },
    { personId: 'p_dana', householdId: 'h_c', role: 'parent' },
    { personId: 'p_jax', householdId: 'h_c', role: 'child' },
    { personId: 'p_ray', householdId: 'h_d', role: 'parent' },
    { personId: 'p_jax', householdId: 'h_d', role: 'child' },
  ];

  const rel = (
    id: string,
    fromId: string,
    toId: string,
    type: string,
    status = 'ACTIVE',
    createdAt = '2026-10-01',
  ): RelationshipRow => ({
    id,
    fromId,
    toId,
    type,
    status,
    createdAt,
    history: [{ at: createdAt, event: `${status} (${type})` }],
  });

  const relationships: RelationshipRow[] = [
    // Nora
    rel('r_kendra_parent', 'p_mom', 'p_nora', 'parent', 'ACTIVE', '2018-03-14'),
    rel('r_andre_parent', 'p_dad', 'p_nora', 'parent', 'ACTIVE', '2018-03-14'),
    rel('r_leo_brother', 'p_leo', 'p_nora', 'brother', 'ACTIVE', '2018-03-14'),
    rel('r_max_brother', 'p_max', 'p_nora', 'brother', 'ACTIVE', '2018-03-14'),
    rel('r_loretta_grandmother', 'p_gma', 'p_nora', 'grandmother'),
    rel('r_walter_grandfather', 'p_walter', 'p_nora', 'grandfather'),
    rel('r_gloria_grandmother', 'p_gloria', 'p_nora', 'grandmother'),
    rel('r_bryan_uncle', 'p_bryan', 'p_nora', 'uncle'),
    rel('r_tasha_aunt', 'p_tasha', 'p_nora', 'aunt'),
    rel('r_tasha_godmother', 'p_tasha', 'p_nora', 'godmother'),
    rel('r_monique_parent_friend', 'p_monique', 'p_nora', 'parent_friend'),
    rel('r_chris_parent_friend', 'p_chris', 'p_nora', 'parent_friend'),
    rel('r_priya_sitter', 'p_priya', 'p_nora', 'sitter'),
    rel('r_angela_teacher', 'p_price', 'p_nora', 'teacher'),
    rel('r_daniel_substitute', 'p_okafor', 'p_nora', 'substitute_teacher'),
    rel('r_carol_nurse', 'p_jennings', 'p_nora', 'school_nurse'),
    rel('r_gary_bus_driver', 'p_holt', 'p_nora', 'bus_driver'),
    rel('r_marcus_coach', 'p_marcus', 'p_nora', 'coach'),
    rel('r_dana_friend_parent', 'p_dana', 'p_nora', 'friend_parent', 'DISCOVERED', '2026-10-24'),
    // Jax
    rel('r_dana_parent', 'p_dana', 'p_jax', 'parent', 'ACTIVE', '2018-07-21'),
    rel('r_ray_parent', 'p_ray', 'p_jax', 'parent', 'ACTIVE', '2018-07-21'),
    rel('r_evelyn_grandmother', 'p_evelyn', 'p_jax', 'grandmother'),
    rel('r_jax_angela_teacher', 'p_price', 'p_jax', 'teacher'),
    rel('r_jax_daniel_substitute', 'p_okafor', 'p_jax', 'substitute_teacher'),
    rel('r_jax_marcus_coach', 'p_marcus', 'p_jax', 'coach'),
  ];

  const contactMethods: ContactRow[] = [
    { personId: 'p_mom', channel: 'SMS', value: '+1-313-555-0101', preferred: true, verified: true },
    { personId: 'p_mom', channel: 'EMAIL', value: 'kendra.ellison@example.com', preferred: false, verified: true },
    { personId: 'p_dad', channel: 'SMS', value: '+1-313-555-0102', preferred: true, verified: true },
    { personId: 'p_dad', channel: 'EMAIL', value: 'andre.ellison@example.com', preferred: false, verified: true },
    { personId: 'p_gma', channel: 'CALL', value: '+1-313-555-0103', preferred: true, verified: true },
    { personId: 'p_bryan', channel: 'SMS', value: '+1-313-555-0104', preferred: true, verified: true },
    { personId: 'p_walter', channel: 'CALL', value: '+1-313-555-0105', preferred: true, verified: true },
    { personId: 'p_gloria', channel: 'SMS', value: '+1-313-555-0106', preferred: true, verified: true },
    { personId: 'p_tasha', channel: 'SMS', value: '+1-313-555-0107', preferred: true, verified: true },
    { personId: 'p_monique', channel: 'SMS', value: '+1-313-555-0108', preferred: true, verified: true },
    { personId: 'p_chris', channel: 'SMS', value: '+1-313-555-0109', preferred: true, verified: true },
    { personId: 'p_priya', channel: 'SMS', value: '+1-313-555-0110', preferred: true, verified: true },
    { personId: 'p_dana', channel: 'SMS', value: '+1-313-555-0111', preferred: true, verified: false },
    { personId: 'p_ray', channel: 'SMS', value: '+1-313-555-0112', preferred: true, verified: true },
    { personId: 'p_evelyn', channel: 'CALL', value: '+1-313-555-0113', preferred: true, verified: true },
    { personId: 'p_leo', channel: 'SMS', value: '+1-313-555-0114', preferred: true, verified: false },
    { personId: 'p_max', channel: 'SMS', value: '+1-313-555-0115', preferred: true, verified: false },
    { personId: 'p_price', channel: 'EMAIL', value: 'angela.price@example.com', preferred: true, verified: true },
    { personId: 'p_okafor', channel: 'EMAIL', value: 'daniel.okafor@example.com', preferred: true, verified: true },
    { personId: 'p_jennings', channel: 'EMAIL', value: 'carol.jennings@example.com', preferred: true, verified: true },
    { personId: 'p_holt', channel: 'SMS', value: '+1-313-555-0119', preferred: true, verified: true },
    { personId: 'p_marcus', channel: 'SMS', value: '+1-313-555-0120', preferred: true, verified: true },
  ];

  const capabilities = [
    ...['p_gma', 'p_bryan', 'p_tasha', 'p_monique', 'p_chris', 'p_walter', 'p_dana', 'p_ray', 'p_evelyn'].map(
      (personId) => ({ personId, name: 'transport.child', conditions: null }),
    ),
    { personId: 'p_priya', name: 'supervise.child', conditions: null },
    { personId: 'p_leo', name: 'supervise.sibling', conditions: null },
    { personId: 'p_dana', name: 'host.playdate', conditions: null },
    { personId: 'p_marcus', name: 'activities.update', conditions: null },
    { personId: 'p_price', name: 'school.report', conditions: null },
    { personId: 'p_jennings', name: 'school.report', conditions: null },
    { personId: 'p_holt', name: 'transport.roster', conditions: null },
  ];

  const groups = [
    { id: 'g_room12', name: 'Room 12, Lincoln Elementary', kind: 'class' },
    { id: 'g_school', name: 'Lincoln Elementary', kind: 'school' },
    { id: 'g_route14', name: 'Bus Route 14', kind: 'bus' },
    { id: 'g_tigers', name: 'Tigers U9 soccer', kind: 'team' },
  ];

  const memberships = [
    { personId: 'p_price', groupId: 'g_room12', role: 'teacher' },
    { personId: 'p_okafor', groupId: 'g_room12', role: 'substitute' },
    { personId: 'p_nora', groupId: 'g_room12', role: 'student' },
    { personId: 'p_jax', groupId: 'g_room12', role: 'student' },
    { personId: 'p_jennings', groupId: 'g_school', role: 'nurse' },
    { personId: 'p_holt', groupId: 'g_route14', role: 'driver' },
    { personId: 'p_nora', groupId: 'g_route14', role: 'rider' },
    { personId: 'p_marcus', groupId: 'g_tigers', role: 'coach' },
    { personId: 'p_nora', groupId: 'g_tigers', role: 'player' },
    { personId: 'p_jax', groupId: 'g_tigers', role: 'player' },
  ];

  const goals = [
    {
      id: 'goal_reading',
      childId: 'p_nora',
      title: 'Reading level 3 by June',
      ownerId: 'p_mom',
      proposedById: null,
      horizon: 'June 2027',
      status: 'APPROVED',
    },
    {
      id: 'goal_passing',
      childId: 'p_nora',
      title: 'Left-foot passing this season',
      ownerId: null,
      proposedById: 'p_marcus',
      horizon: '2026 season',
      status: 'PROPOSED',
    },
  ];

  const carePlans = [
    { childId: 'p_nora', text: 'Peanut allergy. Epi-pen in right backpack pocket.' },
    { childId: 'p_jax', text: 'Mild asthma. Inhaler in the front pocket of the school bag.' },
  ];

  const grant = (
    id: string,
    actorId: string,
    childId: string,
    scopes: string[],
    grantedBy: string,
    validFrom: string | null = null,
    validUntil: string | null = null,
  ) => ({ id, actorId, childId, scopes, validFrom, validUntil, grantedBy });

  const grants = [
    grant('g_loretta', 'p_gma', 'p_nora', ['pickup.request', 'schedule.read', 'goals.read'], 'p_mom'),
    grant('g_bryan', 'p_bryan', 'p_nora', ['pickup.request', 'schedule.read'], 'p_mom'),
    grant('g_tasha', 'p_tasha', 'p_nora', ['pickup.request', 'schedule.read', 'goals.read'], 'p_mom'),
    grant('g_monique', 'p_monique', 'p_nora', ['pickup.request', 'schedule.read'], 'p_mom'),
    grant('g_walter', 'p_walter', 'p_nora', ['schedule.read', 'goals.read'], 'p_dad'),
    grant('g_gloria', 'p_gloria', 'p_nora', ['schedule.read', 'goals.read'], 'p_dad'),
    grant('g_priya', 'p_priya', 'p_nora', ['supervise.request', 'schedule.read', 'careplan.read'], 'p_mom'),
    grant('g_leo', 'p_leo', 'p_nora', ['supervise.request', 'schedule.read'], 'p_mom'),
    grant('g_angela', 'p_price', 'p_nora', ['school.read', 'careplan.read', 'pickup.verify'], 'p_mom'),
    // Daniel's window must COVER the demo dates rather than pin one day: a single-day window made
    // 06a pass or fail depending on the wall clock at run time (it went red at 00:00 on Oct 27).
    grant('g_daniel', 'p_okafor', 'p_nora', ['careplan.read'], 'p_mom', '2026-10-20', '2026-11-30'),
    grant('g_carol', 'p_jennings', 'p_nora', ['careplan.read', 'school.read'], 'p_mom'),
    // Deliberately expired before today: proves the date window is evaluated, with no clock
    // manipulation. Chris holds careplan.read for Nora, and the window closed 2026-09-30.
    grant('g_chris_expired', 'p_chris', 'p_nora', ['careplan.read'], 'p_mom', '2026-09-01', '2026-09-30'),
    grant('g_gary', 'p_holt', 'p_nora', ['transport.read'], 'p_mom'),
    // Jax's village
    grant('g_evelyn', 'p_evelyn', 'p_jax', ['pickup.request', 'schedule.read'], 'p_dana'),
    grant('g_jax_angela', 'p_price', 'p_jax', ['school.read', 'pickup.verify'], 'p_dana'),
  ];

  const approvals: Seed['approvals'] = [];

  const policies = [
    { householdId: 'h_a', rule: 'sibling_supervision_min_age', value: '16' },
    { householdId: 'h_a', rule: 'caregiver_approval', value: 'ANY_PARENT' },
    // Station 06: the household's ride-cost cap. `over the cap` is a permissibility flag, never a
    // refusal — the approver's approvePickup is what authorizes crossing it (pickup-job.md §6a).
    { householdId: 'h_a', rule: 'ride_cost_cap_usd', value: '10' },
  ];

  const schedules = [
    { childId: 'p_nora', parentId: 'p_mom', weekdays: ['MON', 'TUE', 'WED'] },
    { childId: 'p_nora', parentId: 'p_dad', weekdays: ['THU', 'FRI', 'SAT', 'SUN'] },
    { childId: 'p_jax', parentId: 'p_dana', weekdays: ['MON', 'TUE', 'WED', 'THU'] },
    { childId: 'p_jax', parentId: 'p_ray', weekdays: ['FRI', 'SAT', 'SUN'] },
  ];

  const events = [
    {
      id: 'e_school_1026',
      childId: 'p_nora',
      title: 'School',
      start: '2026-10-26T08:15:00',
      end: '2026-10-26T15:00:00',
      location: 'Room 12, Lincoln Elementary',
    },
  ];

  const busRosters = [{ date: '2026-10-26', childId: 'p_nora', route: 'Route 14', riding: true }];

  const vehicles = [
    { id: 'v_101', ownerId: 'p_mom', year: 2021, make: 'Honda', model: 'CR-V', color: 'gray', plate: 'DEMO-101' },
    { id: 'v_102', ownerId: 'p_dad', year: 2019, make: 'Ford', model: 'F-150', color: 'black', plate: 'DEMO-102' },
    { id: 'v_103', ownerId: 'p_gma', year: 2016, make: 'Buick', model: 'Enclave', color: 'white', plate: 'DEMO-103' },
    { id: 'v_104', ownerId: 'p_bryan', year: 2020, make: 'Dodge', model: 'Charger', color: 'blue', plate: 'DEMO-104' },
    { id: 'v_105', ownerId: 'p_tasha', year: 2022, make: 'Toyota', model: 'RAV4', color: 'red', plate: 'DEMO-105' },
    { id: 'v_106', ownerId: 'p_monique', year: 2023, make: 'Kia', model: 'Telluride', color: 'silver', plate: 'DEMO-106' },
    { id: 'v_107', ownerId: 'p_chris', year: 2015, make: 'Chevrolet', model: 'Malibu', color: 'gray', plate: 'DEMO-107' },
    { id: 'v_108', ownerId: 'p_walter', year: 2012, make: 'Cadillac', model: 'DTS', color: 'black', plate: 'DEMO-108' },
    { id: 'v_109', ownerId: 'p_priya', year: 2014, make: 'Toyota', model: 'Corolla', color: 'white', plate: 'DEMO-109' },
    { id: 'v_110', ownerId: 'p_dana', year: 2018, make: 'Chrysler', model: 'Pacifica', color: 'silver', plate: 'DEMO-110' },
    { id: 'v_111', ownerId: 'p_ray', year: 2017, make: 'Jeep', model: 'Grand Cherokee', color: 'green', plate: 'DEMO-111' },
    { id: 'v_112', ownerId: 'p_evelyn', year: 2019, make: 'Buick', model: 'Encore', color: 'blue', plate: 'DEMO-112' },
  ];

  const practices = [
    { id: 'pr_tigers_1026', groupId: 'g_tigers', start: '2026-10-26T17:30:00', location: 'Field 2' },
  ];

  return {
    people,
    children,
    villages,
    households,
    householdMembers,
    relationships,
    contactMethods,
    capabilities,
    groups,
    memberships,
    goals,
    carePlans,
    grants,
    approvals,
    policies,
    schedules,
    events,
    busRosters,
    vehicles,
    practices,
    schoolReports: [],
    permissionSlips: [],
    coordinationJobs: [],
    attempts: [],
    informationRequests: [],
    confirmations: [],
  };
}
