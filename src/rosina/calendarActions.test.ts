import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarProposal} from './calendarActions';
const children=[{id:'p_nora',displayName:'Nora Ellison',scopes:new Set(['schedule.read'])}];
const events=[{id:'ev-party',title:"Nora's birthday party",start:'2026-11-05T21:00:00',end:'2026-11-05T22:00:00',location:'Home',notes:'Keep this',color:'#ff0000',status:'confirmed'}];
const request=(allowed=true,rows=events)=>async()=>new Response(JSON.stringify({data:{calendarWriteAccess:allowed,childEvents:rows}}),{status:200});
const base={children,bearer:'fictional-test',graphqlUrl:'http://unused',today:'2026-11-04',history:[],request:request() as typeof fetch};
test('birthday proposal resolves Detroit tomorrow without writing',async()=>{
 const r=await calendarProposal({...base,message:'book a birthday party for Nora Ellison at 9pm tomorrow'});
 assert.equal(r?.actions[0]?.args.start,'2026-11-05T21:00:00');assert.equal(r?.actions[0]?.args.operation,'create');
});
test('move it resolves last saved event and retains duration and metadata',async()=>{
 const r=await calendarProposal({...base,message:'move it to 7pm',history:[{role:'assistant' as const,content:"Done: added Nora's birthday party for Nora Ellison. Thu 9:00 PM."}]});
 assert.equal(r?.actions[0]?.args.eventId,'ev-party');assert.equal(r?.actions[0]?.args.start,'2026-11-05T19:00:00');assert.equal(r?.actions[0]?.args.notes,'Keep this');
});
test('refuses unauthorized caller, ambiguous event and unknown child',async()=>{
 assert.equal((await calendarProposal({...base,message:'book a party for Nora at 9pm tomorrow',request:request(false) as typeof fetch}))?.actions.length,0);
 assert.equal((await calendarProposal({...base,message:'move birthday party to 7pm',request:request(true,[...events,{...events[0],id:'ev-other'}]) as typeof fetch}))?.actions.length,0);
 assert.equal((await calendarProposal({...base,message:'book a party for Jax at 9pm tomorrow'}))?.actions.length,0);
});
test('preserves an explicit new end time on reschedule',async()=>{
 const r=await calendarProposal({...base,message:"move Nora's birthday party to 7pm until 8:30pm"});
 assert.equal(r?.actions[0]?.args.start,'2026-11-05T19:00:00');
 assert.equal(r?.actions[0]?.args.end,'2026-11-05T20:30:00');
});
test('rejects nonexistent and ambiguous Detroit wall times and invalid dates',async()=>{
 for(const when of ['2027-03-14 at 2:30am','2027-11-07 at 1:30am','2026-02-30 at 9pm']){
  const r=await calendarProposal({...base,message:`book a birthday party for Nora on ${when}`});
  assert.equal(r?.actions.length,0);
 }
});
