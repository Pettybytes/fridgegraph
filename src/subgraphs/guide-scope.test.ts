import assert from 'node:assert/strict';
import { test } from 'node:test';
import village from './village';
import access from './access';
import coordination from './coordination';
import schedule from './schedule';
import school from './school';
import transport from './transport';
import activities from './activities';
import { authorizeChild, guideCanReadChild, type Ctx } from '../authz';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  household_members: [
    { person_id: 'p_nora', household_id: 'h_a', role: 'child' },
    { person_id: 'p_mom', household_id: 'h_a', role: 'parent' },
    { person_id: 'p_jax', household_id: 'h_c', role: 'child' },
    { person_id: 'p_dana', household_id: 'h_c', role: 'parent' },
  ],
  coordination_jobs: [{id:'job',child_id:'p_jax',type:'PICKUP',status:'pending'}],
  memberships: [{person_id:'p_jax',group_id:'group'}],
  households: [{ id: 'h_a', village_id: 'v_nora', sandbox: true }, { id: 'h_c', village_id: 'v_jax', sandbox: true }],
  relationships: [{ id: 'rel', from_id: 'p_dana', to_id: 'p_jax', type: 'PARENT', status: 'APPROVED' }],
  goals: [{ id: 'goal', child_id: 'p_jax', status: 'PROPOSED', text: 'Read together' }],
  grants: [{ id: 'grant', actor_id: 'p_helper', child_id: 'p_jax', scopes: ['schedule.read'] }],
  household_policies: [{ household_id: 'h_c', rule: 'consent_approval', value: 'parent' }],
  care_plans: [{ child_id: 'p_jax', text: 'Inhaler in school bag' }],
  recorded_places: [{ id: 'place', household_id: 'h_c', label: 'Home', kind: 'HOME' }],
};
function context(guide = true): Ctx {
  return { callerId: guide ? 'p_demo_guide' : 'p_mom', demoGuide: guide, today: '2026-11-03', db: {
    from(table: string) {
      let selected = tables[table] ?? [];
      let single = false;
      const q = {
        select() { return q; },
        eq(key: string, value: unknown) { selected = selected.filter(r => r[key] === value); return q; },
        in(key: string, values: unknown[]) { selected = selected.filter(r => values.includes(r[key])); return q; },
        gte() { return q; }, lte() { return q; }, not() { return q; },
        order() { return q; }, limit() { return q; },
        maybeSingle() { single = true; return q; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: single ? selected[0] ?? null : selected, error: null }).then(resolve); },
      };
      return q;
    },
    rpc(name: string) { if (name === 'is_sandbox_person') return Promise.resolve({data:true,error:null}); return Promise.resolve({ data: [{ recorded: true, label: 'check-in', due_at: null }], error: null }); },
  } as never };
}
const reads = [
  ['households', village.resolvers.Query.households, { childId: 'p_jax' }],
  ['householdMembers', village.resolvers.Query.householdMembers, { childId: 'p_jax' }],
  ['relationships', village.resolvers.Query.relationships, { childId: 'p_jax' }],
  ['goals', village.resolvers.Query.goals, { childId: 'p_jax' }],
  ['carePlan', village.resolvers.Query.carePlan, { childId: 'p_jax' }],
  ['grants', access.resolvers.Query.grants, { childId: 'p_jax' }],
  ['householdPolicy', access.resolvers.Query.householdPolicy, { householdId: 'h_c' }],
  ['checkInStatus', coordination.resolvers.Query.checkInStatus, { childId: 'p_jax' }],
  ['orbitPlaces', coordination.resolvers.Query.orbitPlaces, { childId: 'p_jax' }],
] as const;
for (const [name, resolver, args] of reads) {
  const read = resolver as (root: unknown, args: unknown, ctx: Ctx) => Promise<unknown>;
  test(`guide reads ${name} across families`, async () => {
    const result = await read(null, args, context());
    assert.ok(Array.isArray(result) ? result.length > 0 : result);
  });
  test(`Kendra cannot read Dana's ${name}`, async () => {
    if (name === 'orbitPlaces') assert.deepEqual(await read(null, args, context(false)), []);
    else await assert.rejects(read(null, args, context(false)), /UNAUTHORIZED/);
  });
}
for (const [name, subgraph] of Object.entries({ village, access, coordination, schedule, school, transport, activities })) {
  const mutations = (subgraph.resolvers as { Mutation?: Record<string, (root: unknown, args: unknown, ctx: Ctx) => unknown> }).Mutation ?? {};
  for (const [field, mutate] of Object.entries(mutations)) {
    test(`guide without the verified demo action identity cannot write ${name}.${field}`, async () => {
      const ctx: Ctx = { callerId: 'p_demo_guide', demoGuide: true, today: '2026-11-03', db: new Proxy({}, { get() { throw Error('Database touched before guide refusal'); } }) as never };
      await assert.rejects(async () => mutate(null, {}, ctx), /DEMO_GUIDE_READ_ONLY/);
    });
  }
}

test('showcase read grant excludes non-fictional families even if a row is visible', async () => {
 const row = tables.households.find(row => row.id === 'h_c')!;
 row.sandbox = false;
 try { assert.equal(await guideCanReadChild(context(), 'p_jax'), false); }
 finally { row.sandbox = true; }
});
test('a family identity cannot acquire showcase read scope from a guide flag', async () => {
 assert.equal(await guideCanReadChild({...context(), callerId:'p_mom'}, 'p_jax'), false);
});

for (const [name, subgraph] of Object.entries({ village, access, coordination, schedule, school, transport, activities })) {
 for (const [field, resolver] of Object.entries(subgraph.resolvers.Query)) {
  test(`showcase read grant is accepted by ${name}.${field}`, async () => {
   const args = {childId:'p_jax', personId:'p_dana', householdId:'h_c', groupId:'group', jobId:'job', candidateId:'p_helper', id:'record', alertId:'record', date:'2026-11-03', from:'2026-11-01', to:'2026-11-30'};
   await assert.doesNotReject(async () => (resolver as (root:unknown,args:unknown,ctx:Ctx)=>unknown)(null,args,context()));
  });
 }
}

for (const scope of ['pickup.request', 'pickup.verify', 'supervise.request', 'school.report', 'fridge.post']) {
 test(`showcase read grant alone never authorizes ${scope}`, async () => {
  await assert.rejects(authorizeChild(context(), 'p_jax', scope), /UNAUTHORIZED/);
 });
}
