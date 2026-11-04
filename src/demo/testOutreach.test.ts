/**
 * Gates for the in-app TEST-responder outreach (src/demo/testOutreach.ts). No network: the
 * service-role fetch is a path-routed stub, and the simulated reply timer is observed through it.
 *
 *   node --import tsx --test src/demo/testOutreach.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTestOutreach, type ServiceFetch } from './testOutreach';

type Call = { path: string; body?: unknown };

function stubService(rows: {
  job?: { id: string; child_id: string; status: string; request_version: number; sandbox?: boolean } | null;
  openAttempts?: { id: string }[];
  evaluations?: { candidate_id: string }[];
  vehicles?: { owner_id: string }[];
}, calls: Call[] = []): { service: ServiceFetch; calls: Call[] } {
  const service: ServiceFetch = async (path, init) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.startsWith('/rest/v1/coordination_jobs')) return json(rows.job ? [rows.job] : []);
    if (path.startsWith('/rest/v1/attempts?')) return json(rows.openAttempts ?? []);
    if (path.startsWith('/rest/v1/candidate_evaluations')) return json(rows.evaluations ?? []);
    if (path.startsWith('/rest/v1/vehicles')) return json(rows.vehicles ?? []);
    if (path === '/rest/v1/attempts') return new Response(null, { status: 201 });
    if (path === '/rest/v1/rpc/accept_pickup_webhook') return json('recorded');
    return new Response('{}', { status: 404 });
  };
  return { service, calls };
}

const JOB = { id: 'job_x', child_id: 'p_nora', status: 'discovering', request_version: 1, sandbox: true };

test('refuses a caller who is not a demo parent of the job\'s child', async () => {
  const { service } = stubService({ job: JOB });
  const dana = await runTestOutreach({ service }, 'p_dana', 'job_x'); // Dana parents Jax, not Nora
  assert.equal(dana.status, 403);
  const stranger = await runTestOutreach({ service }, 'p_tasha', 'job_x');
  assert.equal(stranger.status, 403);
});

test('refuses a job that is not discovering, a missing job, and a second open attempt', async () => {
  const { service: terminal } = stubService({ job: { ...JOB, status: 'awaiting_approval' } });
  assert.equal((await runTestOutreach({ service: terminal }, 'p_mom', 'job_x')).status, 409);
  const { service: missing } = stubService({ job: null });
  assert.equal((await runTestOutreach({ service: missing }, 'p_mom', 'job_x')).status, 404);
  const { service: open } = stubService({ job: JOB, openAttempts: [{ id: 'att_open' }] });
  assert.equal((await runTestOutreach({ service: open }, 'p_mom', 'job_x')).status, 409);
});

test('roster only, vehicle preferred: Tasha (has a car) beats Loretta; a non-roster candidate is never contacted', async () => {
  const calls: Call[] = [];
  const { service } = stubService({
    job: JOB,
    evaluations: [{ candidate_id: 'p_monique' }, { candidate_id: 'p_gma' }, { candidate_id: 'p_tasha' }],
    vehicles: [{ owner_id: 'p_tasha' }],
  }, calls);
  const result = await runTestOutreach({ service, replyDelayMs: 1 }, 'p_mom', 'job_x');
  assert.equal(result.status, 200);
  assert.equal(result.body.candidateId, 'p_tasha', 'the vehicle-holding TEST responder wins');
  assert.equal(result.body.simulated, true, 'the response says simulated, plainly');
  const insert = calls.find((c) => c.path === '/rest/v1/attempts');
  assert.ok(insert, 'one attempt row inserted');
  const row = (insert!.body as Record<string, unknown>[])[0];
  assert.equal(row.destination_mode, 'TEST_RESPONDER');
  assert.equal(row.candidate_id, 'p_tasha');
  // The simulated reply goes through the SAME webhook RPC the SMS path uses.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const reply = calls.find((c) => c.path === '/rest/v1/rpc/accept_pickup_webhook');
  assert.ok(reply, 'simulated reply recorded through accept_pickup_webhook');
  assert.equal((reply!.body as { p_available: boolean }).p_available, true);
});

test('no evaluated TEST-roster candidate: refused, nothing written', async () => {
  const calls: Call[] = [];
  const { service } = stubService({ job: JOB, evaluations: [{ candidate_id: 'p_monique' }] }, calls);
  const result = await runTestOutreach({ service }, 'p_mom', 'job_x');
  assert.equal(result.status, 409);
  assert.ok(!calls.some((c) => c.path === '/rest/v1/attempts' && c.body), 'no attempt inserted');
});

test('showcase outreach consumes explicit child authority and keeps the TEST roster',async()=>{
 for(const allowed of [false,true]){
  const {service,calls}=stubService({job:JOB,evaluations:[{candidate_id:'p_tasha'}]});
  const result=await runTestOutreach({service,authorizeChild:async child=>{assert.equal(child,'p_nora');return allowed},replyDelayMs:1},'p_demo_guide',JOB.id);
  assert.equal(result.status,allowed?200:403);
  assert.equal(calls.some(call=>call.path==='/rest/v1/attempts'),allowed);
  if(allowed){assert.equal(result.body.candidateId,'p_tasha');assert.equal(result.body.simulated,true)}
 }
});

test('showcase outreach refuses unmarked jobs even with child authority',async()=>{
 const {service,calls}=stubService({job:{...JOB,sandbox:false},evaluations:[{candidate_id:'p_tasha'}]});
 const result=await runTestOutreach({service,authorizeChild:async()=>true},'p_demo_guide',JOB.id);
 assert.equal(result.status,403);
 assert.ok(!calls.some(call=>call.path==='/rest/v1/attempts'));
});
