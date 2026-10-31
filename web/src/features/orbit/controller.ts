import {ActivityLedger} from '@/components/signature/activityLedger'
import {descriptorKeys,vocabularyKinds,orbitError} from './adapter'
import type {OrbitAdapter,CheckIn,Vocabulary,Descriptors,DescriptorKey,Alert,Status,Preview,ResponseChoice} from './adapter'
export type Phase='loading'|'idle'|'editing'|'preparing'|'preview'|'activating'|'active'|'closed'|'unavailable'
export type OrbitState={phase:Phase;busy:string|null;check:CheckIn|null;vocabulary:Vocabulary[];values:Descriptors;photoId?:string;preview:Preview|null;alert:Alert|null;status:Status|null;error:string;guidance:string;authority:boolean;revision:number;previewRevision:number;closeConfirm:boolean;started:boolean}
export type OrbitScope={childId:string;personId:string;parent:boolean;readOnly:boolean;generation:number}
export function overdue(check:CheckIn|null,now=Date.now()){return !!check&&!check.recorded&&!!check.dueAt&&Number.isFinite(Date.parse(check.dueAt))&&Date.parse(check.dueAt)<now}
export class OrbitController{
 readonly responseActivity=new ActivityLedger()
 private state:OrbitState={phase:'loading',busy:null,check:null,vocabulary:[],values:{},preview:null,alert:null,status:null,error:'',guidance:'',authority:false,revision:0,previewRevision:-1,closeConfirm:false,started:false}
 private listeners=new Set<()=>void>();private alive=true;private operation=0;private readSequence=0;private mediaAbort=new AbortController();private loadFlight:Promise<void>|null=null;private refreshFlight:{id?:string;promise:Promise<void>}|null=null
 readonly adapter:OrbitAdapter;readonly scope:OrbitScope;private generation:()=>number;private now:()=>number
 constructor(adapter:OrbitAdapter,scope:OrbitScope,generation:()=>number,now:()=>number=Date.now){this.adapter=adapter;this.scope=scope;this.generation=generation;this.now=now}
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
    const [statusResult,checkResult,vocabularyResult]=await Promise.allSettled([this.adapter.status(this.scope.childId),this.scope.parent&&!this.scope.readOnly?this.adapter.check(this.scope.childId):Promise.resolve(null),this.scope.parent&&!this.scope.readOnly?this.adapter.vocabulary():Promise.resolve([])])
    if(!this.current())return
    const check=checkResult.status==='fulfilled'?checkResult.value:null
    const guidance=check?.guidance||(statusResult.status==='fulfilled'?statusResult.value.guidance:'')
    this.patch({check,guidance,authority:!!check})
    if(statusResult.status==='rejected')throw statusResult.reason
    if(checkResult.status==='rejected')throw checkResult.reason
    if(vocabularyResult.status==='rejected')throw vocabularyResult.reason
    const status=statusResult.value,vocabulary=vocabularyResult.value
    this.patch({status,vocabulary,error:''})
    if(status.alertId){const alert=await this.adapter.alert(status.alertId);if(!this.current())return;this.record(alert)}else if(!this.state.started)this.patch({phase:'idle',alert:null,photoId:undefined})
   }catch(error){this.patch({phase:'unavailable',error:orbitError(error)})}
   finally{this.loadFlight=null}
  })();return this.loadFlight
 }
 private record(alert:Alert|null){
  if(!this.current())return
  if(alert&&alert.child.id!==this.scope.childId){this.patch({alert:null,photoId:undefined,phase:'unavailable',error:"This isn't shared with you."});return}
  const phase=alert?.status==='ACTIVE'?'active':alert?.status==='CLOSED'?'closed':this.state.started?'editing':'idle'
  this.patch({alert,phase,preview:null,closeConfirm:alert?.status==='ACTIVE'?this.state.closeConfirm:false,photoId:alert?.share.photoId??undefined,guidance:alert?.guidance||this.state.guidance})
 }
 refresh(alertId?:string){
  if(!this.current()||this.state.busy)return Promise.resolve()
  if(this.refreshFlight)return this.refreshFlight.promise
  const operation=this.operation,sequence=++this.readSequence
  const owns=()=>this.current()&&operation===this.operation&&sequence===this.readSequence
  const flight={id:alertId,promise:Promise.resolve()};this.refreshFlight=flight
  flight.promise=(async()=>{
   try{const status=await this.adapter.status(this.scope.childId,alertId);if(!owns())return;const alert=status.alertId?await this.adapter.alert(status.alertId):null;if(!owns())return;this.patch({status,error:''});this.record(alert)}catch(error){if(owns())this.patch({error:orbitError(error)})}
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
  const revision=this.state.revision,values={...this.state.values},photoId=this.state.photoId
  this.patch({busy:'preview',phase:'preparing',preview:null,error:''})
  try{
   const draft=await this.adapter.draft(this.scope.childId,values,photoId)
   if(!this.current()||revision!==this.state.revision)return
   this.patch({guidance:draft.guidance})
   const preview=await this.adapter.preview(draft.draftId)
   if(!this.current()||revision!==this.state.revision)return
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
  try{const alert=await this.adapter.close(id);this.record(alert)}catch(error){this.patch({error:orbitError(error)})}finally{this.patch({busy:null})}
 }
 async upload(file:File){
  if(!this.state.started||!this.canPrepare())return
  ++this.operation
  this.patch({preview:null,revision:this.state.revision+1,phase:'editing',busy:'upload',error:''})
  try{const photoId=await this.adapter.upload(this.scope.childId,file,this.mediaAbort.signal);this.patch({photoId})}catch(error){this.patch({error:orbitError(error)})}finally{this.patch({busy:null})}
 }
 photo(id:string,signal:AbortSignal){if(!this.current())return Promise.reject(Error('SESSION_CHANGED'));return this.adapter.photo(id,signal)}
 dispose=()=>{
  this.mediaAbort.abort();this.state={...this.state,values:{},photoId:undefined,preview:null,alert:null,status:null,check:null,authority:false,guidance:'',phase:'idle',busy:null,error:'',closeConfirm:false,started:false};for(const notify of this.listeners)notify();this.alive=false;this.listeners.clear()
 }
}
