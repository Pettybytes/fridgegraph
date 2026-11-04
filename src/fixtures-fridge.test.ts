import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFridgeSeed,fridgeFamilies,seedFridge} from './fixtures-fridge';
test('every fictional child has deterministic notes, goals and styles with fixed identifiers',()=>{
 const rows=createFridgeSeed();assert.deepEqual(rows,createFridgeSeed());
 for(const family of fridgeFamilies)for(const child of family.children){
  const goals=rows.goals.filter(g=>g.child_id===child);
  assert.ok(goals.length>=2&&goals.length<=4);
  assert.equal(rows.fridge_notes.filter(n=>n.child_id===child).length,2);
  for(const goal of goals){assert.equal(goal.status,'APPROVED');assert.ok(rows.fridge_item_preferences.some(p=>p.child_id===child&&p.item_id===goal.id));}
 }
 const bryan=rows.goals.find(g=>g.title==="Bryan hopes to win Meta's AI Dev Indie track");
 assert.equal(bryan?.child_id,'p_nora');assert.equal(bryan?.horizon,'November 2026');assert.equal(bryan?.status,'APPROVED');
 assert.equal(rows.fridge_item_preferences.find(p=>p.item_id===bryan?.id)?.color,'blue');
});
test('seed upserts only Fridge tables and reset restores through that same seed path',async()=>{
 const calls:{table:string;rows:Record<string,unknown>[];conflict?:string}[]=[];
 await seedFridge(async(table,rows,conflict)=>{calls.push({table,rows,conflict});return rows.length});
 assert.deepEqual(calls.map(c=>c.table),['goals','fridge_notes','fridge_item_preferences']);
 assert.equal(calls[2].conflict,'child_id,kind,item_id');
 const reset=readFileSync('src/demo/reset.ts','utf8');
 assert.ok(reset.indexOf('await restoreFridgeFixtures(c)')>reset.indexOf('const cast = castRowsByTable()'));
 assert.ok(reset.indexOf('await restoreFridgeFixtures(c)')<reset.indexOf("await c.query('commit')"));
 const source=readFileSync('scripts/db.ts','utf8');
 assert.match(source,/await seedFridge\(upsert\)/);
 assert.match(source.slice(source.indexOf('export async function resetDatabase()')),/await seedDatabase\(\)/);
});
