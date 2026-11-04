/** Public, fictional demo content. Fixed identifiers keep seed and Reset demo deterministic. */
export const fridgeFamilies = [
 {key:'ellison',children:['p_nora','p_max','p_leo'],parent:'p_mom',name:'Nora',photos:['sofa','reading','soccer'],occasion:'Family game afternoon',date:'2026-11-21',place:'Ellison kitchen',notes:['Library books go back on Thursday.','Pancakes together on Sunday morning.'],goals:["Bryan hopes to win Meta's AI Dev Indie track",'Cook one new recipe together'],horizons:['November 2026','This autumn']},
 {key:'coleman',children:['p_jax'],parent:'p_dana',name:'Jax',photos:['autumn','sprinklers','school-hug'],occasion:'Backyard birthday picnic',date:'2026-11-15',place:'Coleman backyard',notes:['Jax picked the bedtime story tonight.','Bring the blue water bottle to practice.'],goals:['Ride the park loop without training wheels','Read a chapter together after dinner','Plant herbs in the kitchen window'],horizons:['This autumn','Every week','November 2026']},
 {key:'castellano',children:['p_emma'],parent:'p_rosa',name:'Emma',photos:['baking','reading','classroom'],occasion:'Birthday baking afternoon',date:'2026-11-14',place:'Rosa and Tomás’s kitchen',notes:['Aprons are in the bottom kitchen drawer.','Emma wants to show us her library book.'],goals:['Learn the family bread recipe','Read aloud to Grandpa','Practice the winter recital piece'],horizons:['November 2026','After school','December 2026']},
 {key:'reyes',children:['p_taylor','p_skye'],parent:'p_felicia',name:'Taylor and Skye',photos:['soccer','autumn','baking'],occasion:'Autumn craft afternoon',date:'2026-11-22',place:'Reyes dining room',notes:['Save the colorful leaves for our collage.','Rain boots belong by the back door.'],goals:['Make a nature journal together','Try a new vegetable each week','Finish our family puzzle'],horizons:['This autumn','November 2026','Before winter break']},
 {key:'lee',children:['p_micah','p_avery'],parent:'p_simone',name:'Micah and Avery',photos:['sprinklers','classroom','sofa'],occasion:'Pajamas and pancakes',date:'2026-11-28',place:'Lee family kitchen',notes:['Micah chose Saturday’s pancake topping.','Avery’s drawing is ready for the fridge.'],goals:['Build a bird feeder together','Read our way through the library shelf','Learn a favorite song on the piano'],horizons:['November 2026','This winter','December 2026']},
 {key:'ferris',children:['p_malik'],parent:'p_dwayne',name:'Malik',photos:['school-hug','soccer','autumn'],occasion:'Pizza and board games',date:'2026-11-20',place:'Ferris living room',notes:['Malik is in charge of choosing Friday’s game.','Put the soccer ball back in the porch basket.'],goals:['Practice passing with both feet','Make a comic book together','Take a Saturday library trip'],horizons:['This season','November 2026','Twice this month']},
] as const;

export function createFridgeSeed(){
 const goals:Record<string,unknown>[]=[],fridge_notes:Record<string,unknown>[]=[],fridge_item_preferences:Record<string,unknown>[]=[];
 for(const family of fridgeFamilies)for(const child of family.children){
  family.goals.forEach((title,index)=>{
   const id=`fridge_demo_goal_${child}_${index}`;
   goals.push({id,child_id:child,title:family.key==='ellison'&&child!=='p_nora'&&index===0?'Make time for a family game night':title,owner_id:family.parent,proposed_by_id:family.parent,horizon:family.horizons[index],status:'APPROVED',period:null,completed_at:null,sandbox:true});
   fridge_item_preferences.push({child_id:child,kind:'goal',item_id:id,position:null,color:['blue','green','red'][index%3],font:index%2?'caveat':'kalam'});
  });
  family.notes.forEach((text,index)=>{
   const id=`fridge_demo_note_${child}_${index}`;
   fridge_notes.push({id,child_id:child,author_id:family.parent,text,paper_color:index?'green':'yellow',audience:'PARENTS_ONLY',attachment_ref:null,created_at:'2026-11-03T12:00:00Z',updated_at:'2026-11-03T12:00:00Z',revision:1,sandbox:true});
   fridge_item_preferences.push({child_id:child,kind:'note',item_id:id,position:{x:index?.351:.218,y:.37,width:.105,rotation:index?3:-3},color:null,font:null});
  });
 }
 return {goals,fridge_notes,fridge_item_preferences};
}

export async function seedFridge(write:(table:string,rows:Record<string,unknown>[],conflict?:string)=>Promise<number>){
 const rows=createFridgeSeed();let total=0;
 for(const [table,items] of Object.entries(rows))total+=await write(table,items,table==='fridge_item_preferences'?'child_id,kind,item_id':'id');
 return total;
}
