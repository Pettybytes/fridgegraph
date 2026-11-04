/**
 * Guide reads — the regression that emptied the whole app for the judge persona.
 *
 * MEASURED LIVE (2026-11-02, canonical stack `e99be47`, router 4012):
 *   guide JWT claims   app_metadata { demo: true, demo_guide: true }, role authenticated   ✔ correct
 *   careFacts(p_nora)  returns sandbox care facts                                          ✔ works
 *   childEvents(p_nora) returns events                                                     ✔ works
 *   villageWorld(p_nora) returns the child                                                 ✔ works
 *   myChildren         returns []                                                          ✘ THE BUG
 *
 * Every child-scoped screen picks its child from `myChildren`. With an empty list, Today, Care
 * information, Orbit and Living Village all render their empty states — four symptoms, one root.
 *
 * The cause is structural, not a migration: `myChildren` enumerated only the CALLER's memberships and
 * the CALLER's grants, and `p_demo_guide` has neither by design (0025: "no household membership
 * anywhere"). Authorization already knew about guides (`guideCanReadChild`); enumeration did not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import access, { GUIDE_READ_SCOPES } from './access';
import type { Ctx } from '../authz';

type Row = Record<string, unknown>;

function chain(table: Row[]) {
  const filters: Array<(r: Row) => boolean> = [];
  const b = {
    select() { return b; },
    eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return b; },
    in(col: string, vals: unknown[]) { const s = new Set(vals); filters.push((r) => s.has(r[col] as never)); return b; },
    then(onf: (v: { data: unknown; error: null }) => unknown, onr?: unknown) {
      const data = table.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data, error: null }).then(onf, onr as never);
    },
  };
  return b;
}

/** Sandbox children only would be the RLS result; the fake returns what the policy would allow. */
const SANDBOX_CHILDREN: Row[] = [
  { person_id: 'p_avery', household_id: 'h_micah', role: 'child' },
  { person_id: 'p_jax', household_id: 'h_c', role: 'child' },
  { person_id: 'p_leo', household_id: 'h_a', role: 'child' },
  { person_id: 'p_mom', household_id: 'h_a', role: 'parent' },
];

function ctxFor(over: Partial<Ctx>): Ctx {
  return {
    callerId: 'p_demo_guide',
    today: '2026-11-02',
    db: {
      rpc(name:string,args:{p_child:string}) { assert.equal(name,'guide_can_manage_child');return Promise.resolve({data:args.p_child==='p_leo',error:null}); },
      from(name: string) {
        if (name === 'household_members') return chain(SANDBOX_CHILDREN);
        if (name === 'grants') return chain([]);
        throw new Error(`unstubbed table: ${name}`);
      },
    } as never,
    ...over,
  } as Ctx;
}

const myChildren = (access as unknown as { resolvers: { Query: { myChildren: unknown } } }).resolvers.Query.myChildren as unknown as (
  root: unknown, args: unknown, ctx: Ctx,
) => Promise<Array<{ child: { id: string }; scopes: string[] }>>;

test('the guide enumerates the sandbox children (the regression)', async () => {
  const out = await myChildren(null, {}, ctxFor({ demoGuide: true }));
  const ids = out.map((c) => c.child.id);
  assert.deepEqual(ids, ['p_avery', 'p_jax', 'p_leo'], 'guide must see every sandbox child, not its own authority');
  for (const c of out) {
    assert.deepEqual(c.scopes, [...GUIDE_READ_SCOPES].sort(), 'guide scopes are the read-only set');
  }
});

test('the guide read grant alone never includes an action scope', () => {
  for (const forbidden of ['pickup.request', 'pickup.verify', 'supervise.request']) {
    assert.ok(!GUIDE_READ_SCOPES.includes(forbidden), `guide must not hold ${forbidden}`);
  }
  assert.ok(GUIDE_READ_SCOPES.includes('careplan.read'), 'care facts are guide-visible (#36)');
  assert.ok(GUIDE_READ_SCOPES.includes('schedule.read'), 'schedules are guide-visible');
});

test('a non-guide with no memberships and no grants still sees nothing', async () => {
  const out = await myChildren(null, {}, ctxFor({ callerId: 'p_dana', demoGuide: undefined }));
  assert.deepEqual(out, [], 'the guide branch must not widen anyone else');
});

test('verified guide receives action scopes only for the server-authorized showcase child',async()=>{
 const out=await myChildren(null,{},ctxFor({demo:true,demoGuide:true}));
 assert.ok(out.find(c=>c.child.id==='p_leo')?.scopes.includes('showcase.manage'));
 for(const row of out.filter(c=>c.child.id!=='p_leo'))assert.deepEqual(row.scopes,[...GUIDE_READ_SCOPES].sort());
 assert.equal(await access.resolvers.Query.canManageChild(null,{childId:'p_leo'},ctxFor({demo:true,demoGuide:true})),true);
 assert.equal(await access.resolvers.Query.canManageChild(null,{childId:'p_jax'},ctxFor({demo:true,demoGuide:true})),false);
});
