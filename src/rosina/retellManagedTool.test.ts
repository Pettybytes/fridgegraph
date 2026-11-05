import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagedTool, type ManagedBinding } from './retellManagedTool';
const args = { operation: 'create', childId: 'p_nora', childName: 'Nora', eventId: '', title: 'Piano practice', start: '2026-11-05T16:00:00', end: '2026-11-05T16:30:00', location: '', notes: '', color: '', status: 'proposed' };
const request = { name: 'prepare_calendar', call: { call_id: 'test-call' }, args: { childId: 'p_nora', message: 'Piano tomorrow at four for thirty minutes', requestId: 'turn-1' } };
function fixture(model = 'muse-spark-1.3') {
  const binding: ManagedBinding = { session: { personId: 'p_mom', childId: 'p_nora', childIds: ['p_nora'] }, expiresAt: Date.now() + 60000 };
  let writes = 0;
  const tool = createManagedTool({ resolve: token => token === 'test-bind' ? binding : null, facts: async () => 'Nora schedule: no recorded event in this interval', write: async () => { writes++; await new Promise(r => setTimeout(r, 5)); return { model, summary: 'Piano practice tomorrow at four', args }; } });
  return { tool, binding, writes: () => writes };
}
test('managed action uses verified provider author, stores proposal, and concurrent retry reuses its id', async () => {
  const f = fixture();
  const [a,b] = await Promise.all([f.tool.handle('test-bind', request), f.tool.handle('test-bind', request)]);
  assert.equal(a.status, 200); assert.deepEqual(a,b); assert.equal(f.writes(),1);
  assert.equal(f.tool.pending('test-bind')?.length,1);
  assert.equal(f.tool.pending('test-bind')?.[0].authoredBy,'muse-spark-1.3');
  assert.equal(f.tool.pending('test-bind')?.[0].result.recordId,null);
});
test('wrong provider author creates no proposal', async () => {
  const f=fixture('retell-model'); assert.equal((await f.tool.handle('test-bind',request)).status,502); assert.deepEqual(f.tool.pending('test-bind'),[]);
});
test('missing/expired bind, cross-child, changed retry and cross-call are rejected', async () => {
  const f=fixture();
  assert.equal((await f.tool.handle('',request)).status,401);
  assert.equal((await f.tool.handle('test-bind',{...request,args:{...request.args,childId:'p_jax'}})).status,403);
  assert.equal(f.writes(),0);
  await f.tool.handle('test-bind',request);
  assert.equal((await f.tool.handle('test-bind',{...request,args:{...request.args,message:'Different'}})).status,409);
  assert.equal((await f.tool.handle('test-bind',{...request,call:{call_id:'another'}})).status,403);
  f.binding.expiresAt=0;
  assert.equal((await f.tool.handle('test-bind',request)).status,401); assert.equal(f.tool.pending('test-bind'),null);
});
test('read-only tool returns caller facts without invoking Muse writer', async () => {
  const f=fixture(); assert.equal((await f.tool.handle('test-bind',{...request,name:'read_schedule'})).status,200); assert.equal(f.writes(),0); assert.deepEqual(f.tool.pending('test-bind'),[]);
});
