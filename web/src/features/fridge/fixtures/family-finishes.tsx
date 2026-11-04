import {createRoot} from 'react-dom/client'
import {createFridgeSeed,fridgeFamilies} from '../../../../../src/fixtures-fridge'
import {FridgePhase2} from '../FridgePhase2'
import {familyArt} from '../packs'
import {mockFridgeEditingAdapter} from '../mockEditingAdapter'
import {FridgePreferencesContext,type Preference} from '../preferences'
import type {GoalRecord,FridgeNoteRecord} from '../editingContract'
import '../../../index.css'
if(!import.meta.env.DEV)throw Error('Development fixture only')
const params=new URLSearchParams(location.search),child=params.get('child')??'p_nora',guide=params.get('role')==='guide'
const family=fridgeFamilies.find(f=>f.children.some(id=>id===child))
if(!family)throw Error('Unknown fictional fixture')
const seed=createFridgeSeed(),art=familyArt(child)
const goals=seed.goals.filter(g=>g.child_id===child).map(g=>({id:g.id,title:g.title,horizon:g.horizon,status:g.status,period:g.period,completedAt:g.completed_at})) as GoalRecord[]
const notes=seed.fridge_notes.filter(n=>n.child_id===child).map(n=>({id:n.id,text:n.text,author:{id:n.author_id,displayName:family.key},paperColor:String(n.paper_color).toUpperCase(),audience:n.audience,attachmentRef:null,createdAt:n.created_at,updatedAt:n.updated_at,revision:n.revision})) as FridgeNoteRecord[]
const preferences=seed.fridge_item_preferences.filter(p=>p.child_id===child).map(p=>({kind:p.kind,itemId:p.item_id,position:p.position,color:p.color,font:p.font})) as Preference[]
createRoot(document.getElementById('root')!).render(<FridgePreferencesContext.Provider value={{read:async()=>preferences,write:async()=>{throw Error('Read-only fixture transport')}}}><FridgePhase2 enabled viewer={{personId:guide?'p_demo_guide':family.parent,role:guide?'GUIDE':'PARENT',sessionKey:'fixture'}} service={{check:async()=>({kind:'ready'}),adapter:mockFridgeEditingAdapter(goals,notes)}} fridge={{personId:guide?'p_demo_guide':family.parent,childId:child,generation:1,reader:{read:async source=>source==='goals'?{status:'ready',value:goals}:{status:'empty'}},readOnly:guide,sampleSlots:art.slots,albumAssets:art.album,artLabel:art.label,artPackId:art.id}}/></FridgePreferencesContext.Provider>)
