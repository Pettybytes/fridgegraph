// Disposable PostgreSQL only. Never reads runtime credentials or contacts the shared database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { guideDatabase } from './guide-database.mjs';
import { resetSnapshot } from '../src/demo/reset.ts';
import { createShowcaseCalendar } from '../src/fixtures.ts';

const db = await guideDatabase();
try {
  const snapshot = resetSnapshot();
  const restore = () => db.admin.query('select restore_demo_snapshot($1,$2,$3,$4)',
    ['calendar-proof', randomUUID(), JSON.stringify(snapshot.fixtures), JSON.stringify(snapshot.cast)]);
  await restore();
  const children = [...new Set(createShowcaseCalendar().parenting_schedules.map(r => r.child_id))];
  assert.equal(children.length, 10);
  for (const child of children) {
    const coverage = await db.admin.query(`select s.* from generate_series('2026-11-02'::date,'2026-11-08'::date,'1 day') d
      cross join lateral effective_schedule_for($1,d::date) s`, [child]);
    assert.equal(coverage.rows.length, 7);
    for (const row of coverage.rows) { assert.ok(row.parent_id, child); assert.ok(row.handoff_time, child); assert.ok(row.handoff_location, child); }
    assert.equal((await db.admin.query("select * from schedule_conflicts($1,'2026-11-02','2026-11-08')", [child])).rowCount, 0, child);
    assert.equal((await db.admin.query("select * from effective_schedule_for($1,'2026-11-11')", [child])).rows[0].source, 'ARRANGEMENT');
  }
  // Reset must repair a changed row and restore a missing row, leaving unrelated data intact.
  await db.admin.query("update parenting_schedules set handoff_location='Changed' where child_id='p_malik'; delete from parenting_schedules where child_id='p_emma'");
  await restore();
  assert.equal((await db.admin.query("select handoff_location from parenting_schedules where child_id='p_malik'")).rows[0].handoff_location, 'Ferris family home');
  assert.equal((await db.admin.query("select count(*)::int n from parenting_schedules where child_id='p_emma'")).rows[0].n, 2);
  for (const [person, allowedChild, forbiddenChild] of [['p_mom','p_nora','p_jax'],['p_dana','p_jax','p_malik'],['p_dwayne','p_malik','p_nora'],['p_priya','p_nora','p_jax']]) {
    const id = randomUUID();
    await db.admin.query('insert into identity_map(user_id,person_id) values($1,$2)', [id,person]);
    await db.admin.query('begin');
    try {
      await db.admin.query('set local role authenticated');
      await db.admin.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:id,app_metadata:{demo:true}})]);
      assert.ok((await db.admin.query('select * from parenting_schedules where child_id=$1',[allowedChild])).rowCount, person);
      assert.equal((await db.admin.query('select * from parenting_schedules where child_id=$1',[forbiddenChild])).rowCount, 0, person);
      const avail = await db.admin.query("select * from adult_availability_free_busy where start_at >= '2026-11-02' and start_at < '2026-11-09'");
      assert.ok(avail.rowCount, person);
      assert.equal(avail.fields.some(f => f.name === 'reason'), false);
    } finally { await db.admin.query('rollback'); }
  }
  console.log('Calendar data PASS: 10 children × 7 days, no gaps, holiday precedence, handoffs, reset repair, four-perspective isolation and private-reason exclusion');
} finally { await db.close(); }
