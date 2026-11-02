// Imported only by Preview.tsx. Never imported by ConnectedFridge or the production reader.
import {notePositions,samples,type FridgeReader,type Goal,type Slot} from './model'
export const previewGoals:Goal[]=[{id:'sample-goal-1',title:'Read together after dinner',horizon:'When evenings allow',status:'APPROVED'},{id:'sample-goal-2',title:'Try growing herbs',horizon:null,status:'PROPOSED'}]
export const previewPapers:Slot[]=[
 {id:'visual-sketchbook',kind:'note',text:'Bring a sketchbook',caption:'Visual fixture only. No reminder record or listing.',position:{x:.213,y:.439,width:.115,rotation:-4},owner:'visual-author-a',source:'sample',paper:3,magnet:'grade'},
 {id:'visual-leaves',kind:'note',text:'Look for autumn leaves',caption:'Visual fixture only. No reminder record or listing.',position:{x:.216,y:.496,width:.11,rotation:2},owner:'visual-author-b',source:'sample',paper:1,magnet:'flower'},
]
export const populatedSlots=[...samples,...previewPapers]
export function previewReader(mode:string):FridgeReader{return {async read(source){
 if(mode==='refused')return {status:'refused'}
 if(mode==='failed')return {status:'failed'}
 if(source==='goals')return {status:'ready',value:previewGoals}
 if(mode!=='populated')return {status:'empty'}
 return {status:'ready',value:[source==='care'?{id:'care-plan',kind:'note',text:'Peanut allergy. Epi-pen in right backpack pocket.',caption:'Mock care-plan text. One field, one note.',heading:'Care notes',position:notePositions.care,owner:null,source:'sample',paper:0,magnet:'apple',destination:'#/care-information'}:{id:'orbit-visual',kind:'note',text:'Open Orbit Alert',caption:'Mock ACTIVE Orbit state. No alert created.',heading:'Orbit',position:notePositions.orbit,owner:null,source:'sample',paper:2,magnet:'star',destination:'#/orbit?alertId=visual-only'}]}
}}}
