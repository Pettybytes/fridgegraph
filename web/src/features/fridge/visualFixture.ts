// Evidence-only controlled reads; never imported by the production reader.
import {notePositions,samples,type FridgeReader,type Goal} from './model'
export const previewGoals:Goal[]=[{id:'sample-goal-1',title:'Read together after dinner',horizon:'When evenings allow',status:'APPROVED'},{id:'sample-goal-2',title:'Try growing herbs',horizon:null,status:'PROPOSED'}]
export const populatedSlots=samples
export function previewReader(mode:string):FridgeReader{return {async read(source,childId){
 if(mode==='refused')return {status:'refused'}
 if(mode==='failed')return {status:'failed'}
 if(mode!=='populated')return {status:'empty'}
 if(source==='goals')return {status:'ready',value:previewGoals}
 return {status:'ready',value:[{id:'care-plan',kind:'note',text:childId==='p_nora'?'Peanut allergy. Epi-pen in right backpack pocket.':'Bring a water bottle for outdoor play.',caption:'Mock care-plan text. One field, one note.',heading:'Care notes',position:notePositions.care,owner:null,source:'sample',paper:0,magnet:'apple',destination:'#/care-information'}]}
}}}
