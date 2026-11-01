import {unavailablePhotoDescriptors,confirmedVocabularySuggestions,vocabularyByKind,type PhotoDescriptorAdapter} from './photoDescriptors'
import {ActivityLedger} from '@/components/signature/activityLedger'
import {descriptorKeys,vocabularyKinds,orbitError} from './adapter'
import type {OrbitAdapter,CheckIn,Vocabulary,Descriptors,DescriptorKey,Alert,Status,Preview,ResponseChoice,RecordedPlace,LastSeen} from './adapter'
export type Phase='loading'|'idle'|'editing'|'preparing'|'preview'|'activating'|'active'|'closed'|'unavailable'
export type OrbitState={places:RecordedPlace[];placesError:string;lastSeen:LastSeen;photoFlow:boolean;suggestionNotice:string;celebrationKey?:string;phase:Phase;acknowledgedClosure?:{alertId:string;personId:string};busy:string|null;check:CheckIn|null;vocabulary:Vocabulary[];values:Descriptors;photoId?:string;preview:Preview|null;alert:Alert|null;status:Status|null;error:string;guidance:string;authority:boolean;revision:number;previewRevision:number;closeConfirm:boolean;started:boolean}
export type OrbitScope={childId:string;personId:string;parent:boolean;readOnly:boolean;generation:number}
export function overdue(check:CheckIn|null,now=Date.now()){return !!check&&!check.recorded&&!!check.dueAt&&Number.isFinite(Date.parse(check.dueAt))&&Date.parse(check.dueAt)<now}
export class OrbitController{
 readonly responseActivity=new ActivityLedger()
 private state:OrbitState={places:[],placesError:'',lastSeen:{},photoFlow:false,suggestionNotice:'',phase:'loading',busy:null,check:null,vocabulary:[],values:{},preview:null,alert:null,status:null,error:'',guidance:'',authority:false,revision:0,previewRevision:-1,closeConfirm:false,started:false}
 private recipientClosures=new Map<string,Pick<Alert,'closedAt'|'closeOutcome'|'thankyou'>>();private observedActive=new Set<string>();private observedClosed=new Set<string>();private consumedCelebrations=new Set<string>();
 private listeners=new Set<()=>void>();private alive=true;private operation=0;private readSequence=0;private mediaAbort=new AbortController();private loadFlight:Promise<void>|null=null;private refreshFlight:{id?:string;promise:Promise<void>}|null=null
 private photoDescriptors:PhotoDescriptorAdapter;readonly adapter:OrbitAdapter;readonly scope:OrbitScope;private generation:()=>number;private now:()=>number
 constructor(adapter:OrbitAdapter,scope:OrbitScope,generation:()=>number,now:()=>number=Date.now,photoDescriptors:PhotoDescriptorAdapter=unavailablePhotoDescriptors){this.photoDescriptors=photoDescriptors;this.adapter=adapter;this.scope=scope;this.generation=generation;this.now=now}
 checkInOverdue=()=>overdue(this.state.check,this.now())
 getSnapshot=()=>this.state
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
 current=()=>this.alive&&this.generation()===this.scope.generation
 private patch(change:Partial<OrbitState>){if(!this.current())return;this.state={...this.state,...change};for(const notify of this.listeners)notify()}
 canPrepare=()=>this.current()&&['idle','editing','preview','closed'].includes(this.state.phase)&&this.state.authority&&!this.scope.readOnly&&this.state.vocabulary.length>0&&!this.state.busy&&this.state.alert?.status!=='ACTIVE'&&!(this.state.status?.status==='ACTIVE'&&!this.state.alert)
 mayRespond=()=>this.current()&&!this.scope.readOnly&&this.state.alert?.status==='ACTIVE'&&this.state.alert.audience.some(m=>m.person.id===this.scope.personId&&m.eligible)
 load=()=>{
  if(this.loadFlight)return this.loadFlight
  this.loadFlight=(async()=>{
   try{
    const [statusResult,checkResult,vocabularyResult,placesResult]=await Promise.allSettled([this.adapter.status(this.scope.childId),this.scope.parent&&!this.scope.readOnly?this.adapter.check(this.scope.childId):Promise.resolve(null),this.scope.parent&&!this.scope.readOnly?this.adapter.vocabulary():Promise.resolve([]),this.scope.parent&&!this.scope.readOnly&&this.adapter.places?this.adapter.places(this.scope.childId):Promise.resolve([])])
    if(!this.current())return
    const check=checkResult.status==='fulfilled'?checkResult.value:null
    const guidance=check?.guidance||(statusResult.status==='fulfilled'?statusResult.value.guidance:'')
    this.patch({check,guidance,authority:!!check})
    if(statusResult.status==='rejected')throw statusResult.reason
    if(checkResult.status==='rejected')throw checkResult.reason
    if(vocabularyResult.status==='rejected')throw vocabularyResult.reason
    const status=statusResult.value,vocabulary=vocabularyResult.value
    this.patch({status,vocabulary,places:placesResult.status==='fulfilled'?placesResult.value:[],placesError:placesResult.status==='rejected'?"Couldn't load recorded places just now.":'',error:''})
    if(status.alertId){const alert=await this.adapter.alert(status.alertId);if(!this.current())return;this.record(alert)}else if(!this.state.started)this.patch({phase:'idle',alert:null,photoId:undefined})
   }catch(error){this.patch({phase:'unavailable',error:orbitError(error)})}
   finally{this.loadFlight=null}
  })();return this.loadFlight
 }
 private record(alert:Alert|null){
  if(!this.current())return
  if(alert&&alert.child.id!==this.scope.childId){this.patch({alert:null,photoId:undefined,phase:'unavailable',error:"This isn't shared with you."});return}
  if(alert&&!this.state.authority){
   const closure=this.recipientClosures.get(alert.id)
   if(closure)alert={...alert,status:'CLOSED',closedAt:closure.closedAt??alert.closedAt,closeOutcome:closure.closeOutcome??alert.closeOutcome,thankyou:closure.thankyou??alert.thankyou}
   if(alert.status==='CLOSED')this.recipientClosures.set(alert.id,{closedAt:alert.closedAt,closeOutcome:alert.closeOutcome,thankyou:alert.thankyou})
  }
  // Closed recipient reads must never retain sensitive ACTIVE payloads, even if a stale cache returns them.
  if(alert?.status==='CLOSED'&&!this.state.authority){
   const own=(entry:{person:{id:string}})=>entry.person.id===this.scope.personId
   alert={...alert,message:null,share:{photoId:null},lastSeenPlace:null,lastSeenAt:null,audience:alert.audience.filter(own),responses:alert.responses.filter(own),latestResponses:alert.latestResponses.filter(own),guidance:''}
   this.patch({values:{},lastSeen:{},photoId:undefined,preview:null,suggestionNotice:'',guidance:'',status:this.state.status?{...this.state.status,latestResponses:this.state.status.latestResponses.filter(own),guidance:''}:null})
  }
  let celebrationKey:string|undefined
  if(alert?.status==='ACTIVE')this.observedActive.add(alert.id)
  if(alert?.status==='CLOSED'&&alert.closedAt){const key=alert.id+':'+alert.closedAt;if(alert.closeOutcome==='FOUND_SAFE'&&this.observedActive.has(alert.id)&&!this.observedClosed.has(key))celebrationKey=key;this.observedClosed.add(key)}
  const phase=alert?.status==='ACTIVE'?'active':alert?.status==='CLOSED'?'closed':this.state.started?'editing':'idle'
  this.patch({alert,phase,...(celebrationKey?{celebrationKey}:{}),preview:null,closeConfirm:alert?.status==='ACTIVE'?this.state.closeConfirm:false,photoId:alert?.share.photoId??undefined,guidance:alert?.guidance||this.state.guidance})
 }
 refresh(alertId?:string){
  if(!this.current()||this.state.busy)return Promise.resolve()
  if(this.refreshFlight)return this.refreshFlight.promise
  const operation=this.operation,sequence=++this.readSequence
  const owns=()=>this.current()&&operation===this.operation&&sequence===this.readSequence
  const flight={id:alertId,promise:Promise.resolve()};this.refreshFlight=flight
  flight.promise=(async()=>{
   try{const status=await this.adapter.status(this.scope.childId,alertId);if(!owns())return;if(status.status==='CLOSED'&&!this.state.authority&&this.state.alert?.id===status.alertId){this.record({...this.state.alert,status:'CLOSED',closeOutcome:status.closeOutcome??null,thankyou:status.thankyou??null});this.patch({status:{...status,latestResponses:status.latestResponses.filter(r=>r.person.id===this.scope.personId),guidance:''}})}const alert=status.alertId?await this.adapter.alert(status.alertId):null;if(!owns())return;this.patch({status,error:''});this.record(alert)}catch(error){if(owns())this.patch({error:orbitError(error)})}
   finally{if(this.refreshFlight===flight)this.refreshFlight=null}
  })()
  return flight.promise
 }

 private valid(values:Descriptors){return descriptorKeys.every(key=>values[key]===undefined||this.state.vocabulary.some(v=>v.kind===vocabularyKinds[key]&&v.value===values[key]))}
 async prepare(args:Descriptors&{childId:string}){
  if(!this.canPrepare()||args.childId!==this.scope.childId)return
  if(this.state.alert?.status==='ACTIVE'){this.patch({error:'An Orbit alert is already active. Refresh to see its recorded state.'});return}
  if(!Object.keys(args).every(key=>key==='childId'||descriptorKeys.includes(key as DescriptorKey)))return
  const values:Descriptors={};for(const key of descriptorKeys)if(args[key]!==undefined)values[key]=args[key]
  if(!this.valid(values)){this.patch({error:'Choose a description from the available options.'});return}
  ++this.operation
  this.patch({alert:null,status:null,photoId:this.state.alert?.status==='PENDING_ACTIVATION'?this.state.photoId:undefined,started:true,values,revision:this.state.revision+1,preview:null,phase:'editing',error:''})
  await this.review()
 }
 edit(key:DescriptorKey,value:string){
  if(!this.state.started||!this.state.authority||this.scope.readOnly)return
  ++this.operation
  const values={...this.state.values};if(value)values[key]=value;else delete values[key]
  this.patch({values,revision:this.state.revision+1,preview:null,phase:'editing',error:''})
 }
 async review(){
  if(!this.canPrepare()||!this.state.started||!this.valid(this.state.values))return
  ++this.operation
  if(this.state.photoFlow&&(!this.state.lastSeen.lastSeenPlaceId||!this.state.lastSeen.lastSeenAt)){this.patch({error:'Choose the last known place and time before reviewing.'});return}
  const revision=this.state.revision,values={...this.state.values},photoId=this.state.photoId
  this.patch({busy:'preview',phase:'preparing',preview:null,error:''})
  try{
   const draft=await (Object.keys(this.state.lastSeen).length?this.adapter.draft(this.scope.childId,values,photoId,{...this.state.lastSeen}):this.adapter.draft(this.scope.childId,values,photoId))
   if(!this.current()||revision!==this.state.revision)return
   this.patch({guidance:draft.guidance})
   const preview=await this.adapter.preview(draft.draftId)
   if(!this.current()||revision!==this.state.revision)return
   if(preview.draftId!==draft.draftId||preview.draftVersion!==draft.draftVersion||!preview.messageHash)throw Error('ORBIT_PREVIEW_MISMATCH')
   this.patch({preview,previewRevision:revision,guidance:preview.guidance,phase:'preview'})
  }catch(error){if(revision===this.state.revision)this.patch({phase:'editing',preview:null,error:orbitError(error)})}
  finally{if(this.current()){this.patch({busy:null});if(this.state.phase==='preparing')this.patch({phase:'editing'})}}
 }
 confirmable=()=>this.current()&&this.state.authority&&!this.scope.readOnly&&!this.state.busy&&this.state.phase==='preview'&&!!this.state.preview&&this.state.previewRevision===this.state.revision
 async activate(){
  if(!this.confirmable())return
  ++this.operation
  const preview=this.state.preview!
  this.patch({phase:'activating',busy:'activate',error:'',closeConfirm:false})
  try{const alert=await this.adapter.activate(preview);if(!this.current())return;this.patch({preview:null});this.record(alert)}
  catch(error){this.patch({phase:'editing',preview:null,error:orbitError(error)})}
  finally{this.patch({busy:null})}
  if(this.current()&&this.state.alert?.status==='ACTIVE')await this.refresh()
 }
 async respond(response:ResponseChoice){
  if(!this.mayRespond()||this.state.busy||!this.state.alert)return
  ++this.operation
  const id=this.state.alert.id;this.patch({busy:'respond',error:''})
  try{await this.adapter.respond(id,response)}catch(error){this.patch({error:orbitError(error)})}finally{this.patch({busy:null})}
  if(this.current())await this.refresh(id)
 }
 requestClose(){if(this.state.authority&&!this.scope.readOnly&&this.state.alert?.status==='ACTIVE'&&!this.state.busy)this.patch({closeConfirm:true})}
 cancelClose(){this.patch({closeConfirm:false})}
 async close(){
  if(!this.current()||!this.state.closeConfirm||!this.state.authority||this.scope.readOnly||this.state.busy||!this.state.alert)return
  ++this.operation
  const id=this.state.alert.id;this.patch({busy:'close',closeConfirm:false,error:''})
  try{const alert=await this.adapter.close(id,'FOUND_SAFE');this.record(alert);if(alert.status==='CLOSED')this.patch({acknowledgedClosure:{alertId:alert.id,personId:this.scope.personId}})}catch(error){this.patch({error:orbitError(error)})}finally{this.patch({busy:null})}
 }
 async upload(file:File){
  if(!this.state.started||!this.canPrepare())return
  ++this.operation
  this.patch({preview:null,revision:this.state.revision+1,phase:'editing',busy:'upload',error:''})
  try{const photoId=await this.adapter.upload(this.scope.childId,file,this.mediaAbort.signal);this.patch({photoId})}catch(error){this.patch({error:orbitError(error)})}finally{this.patch({busy:null})}
 }
 consumeCelebration(){const key=this.state.celebrationKey;if(!key||this.consumedCelebrations.has(key))return false;this.consumedCelebrations.add(key);return true}
 setLastSeen(key:keyof LastSeen,value:string){
  if(!this.state.started||!this.state.authority||this.scope.readOnly||this.state.busy)return
  if(key==='lastSeenPlaceId'&&value&&!this.state.places.some(place=>place.id===value))return
  if(key==='lastSeenAt'&&value&&!Number.isFinite(Date.parse(value)))return
  ++this.operation;const lastSeen={...this.state.lastSeen};if(value)lastSeen[key]=value;else delete lastSeen[key]
  this.patch({lastSeen,revision:this.state.revision+1,preview:null,phase:'editing',error:''})
 }
 async startPhoto(file:File){
  if(!this.canPrepare())return
  ++this.operation;this.patch({started:true,photoFlow:true,values:{},lastSeen:{},photoId:undefined,preview:null,alert:null,status:null,phase:'editing',suggestionNotice:'',revision:this.state.revision+1})
  await this.upload(file)
  if(!this.current()||!this.state.photoId)return
  const revision=this.state.revision,photoId=this.state.photoId
  this.patch({busy:'descriptors',suggestionNotice:'Checking the photo for description suggestions…'})
  try{const result=await this.photoDescriptors.propose({photoId,childId:this.scope.childId,vocabularyByKind:vocabularyByKind(this.state.vocabulary),signal:this.mediaAbort.signal});if(!this.current()||revision!==this.state.revision)return
   this.patch({values:confirmedVocabularySuggestions(result,this.state.vocabulary),suggestionNotice:result.source==='cached'?'Saved suggestions. Confirm or edit every detail.':'Photo suggestions. Confirm or edit every detail.'})
  }catch{this.patch({suggestionNotice:"Photo suggestions aren't available yet. Choose the details yourself."})}finally{this.patch({busy:null})}
 }
 photo(id:string,signal:AbortSignal){if(!this.current())return Promise.reject(Error('SESSION_CHANGED'));return this.adapter.photo(id,signal)}
 dispose=()=>{
  this.recipientClosures.clear();this.observedActive.clear();this.observedClosed.clear();this.consumedCelebrations.clear();this.responseActivity.clear();this.mediaAbort.abort();this.state={...this.state,places:[],placesError:'',lastSeen:{},photoFlow:false,suggestionNotice:'',celebrationKey:undefined,values:{},photoId:undefined,preview:null,alert:null,status:null,check:null,authority:false,guidance:'',phase:'idle',busy:null,error:'',closeConfirm:false,started:false};for(const notify of this.listeners)notify();this.alive=false;this.listeners.clear()
 }
}
