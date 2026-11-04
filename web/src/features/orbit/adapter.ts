import {gql} from '@apollo/client'
import type {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
export const descriptorKeys=['wearColor','wearGarment','hair','carryColor','carryItem'] as const
export type DescriptorKey=typeof descriptorKeys[number]
export type Descriptors=Partial<Record<DescriptorKey,string>>
export const vocabularyKinds:Record<DescriptorKey,string>={wearColor:'WEAR_COLOR',wearGarment:'WEAR_GARMENT',hair:'HAIR',carryColor:'CARRY_COLOR',carryItem:'CARRY_ITEM'}
export type Vocabulary={kind:string;value:string;version:number}
export type CheckIn={recorded:boolean;label:string;text:string;dueAt:string|null;guidance:string}
export type ResponseEntry={person:{id:string;displayName:string};respondedAt:string;response:string}
export type RecordedPlace={id:string;kind:string;label:string}
export type LastSeen={lastSeenPlaceId?:string;lastSeenAt?:string}
export type Alert={id:string;status:string;child:{id:string};message:string|null;share:Descriptors&{photoId:string|null};activatedAt:string|null;closedAt:string|null;closeOutcome?:string|null;thankyou?:string|null;lastSeenPlace?:RecordedPlace|null;lastSeenAt?:string|null;lastSeenProvenance?:string|null;audience:{person:{id:string;displayName?:string|null};eligible:boolean}[];responses:ResponseEntry[];latestResponses:ResponseEntry[];guidance:string}
export type Status={alertId:string|null;status:string|null;closeOutcome?:string|null;thankyou?:string|null;audienceCount:number;notifiedCount:number;latestResponses:ResponseEntry[];guidance:string}
export type Preview={draftId:string;draftVersion:number;message:string;messageHash:string;audienceSize:number;guidance:string}
export type Draft={draftId:string;draftVersion:number;status:string;guidance:string}
export type ResponseChoice='WITH_ME'|'ON_WAY'|'CANNOT_HELP'
export interface OrbitAdapter{
 places?(childId:string):Promise<RecordedPlace[]>;check(childId:string):Promise<CheckIn>;vocabulary():Promise<Vocabulary[]>;status(childId:string,alertId?:string):Promise<Status>;alert(id:string):Promise<Alert|null>
 draft(childId:string,values:Descriptors,photoId?:string,lastSeen?:LastSeen):Promise<Draft>;preview(id:string):Promise<Preview>;activate(preview:Preview):Promise<Alert>;respond(id:string,response:ResponseChoice):Promise<void>;close(id:string,outcome?:'FOUND_SAFE'):Promise<Alert>
 upload(childId:string,file:File,signal:AbortSignal):Promise<string>;photo(id:string,signal:AbortSignal):Promise<Blob>
}
const RESPONSE=gql`fragment OrbitResponseFields on OrbitResponseEntry{person{id displayName} respondedAt response}`
const ALERT=gql`fragment OrbitAlertFields on OrbitAlert{id status child{id} message share{wearColor wearGarment hair carryColor carryItem photoId} activatedAt closedAt closeOutcome thankyou lastSeenPlace{id kind label} lastSeenAt lastSeenProvenance audience{person{id displayName} eligible} responses{...OrbitResponseFields} latestResponses{...OrbitResponseFields} guidance}${RESPONSE}`
export const PLACES=gql`query WebOrbitPlaces($childId:ID!){orbitPlaces(childId:$childId){id kind label}}`
export const CHECK=gql`query WebOrbitCheck($childId:ID!){checkInStatus(childId:$childId){recorded label text dueAt guidance}}`
export const VOCABULARY=gql`query WebOrbitVocabulary{orbitVocabulary{kind value version}}`
export const STATUS=gql`query WebOrbitStatus($childId:ID!,$alertId:ID){orbitStatus(childId:$childId,alertId:$alertId){alertId status closeOutcome thankyou audienceCount notifiedCount latestResponses{...OrbitResponseFields} guidance}}${RESPONSE}`
export const READ_ALERT=gql`query WebOrbitAlert($alertId:ID!){orbitAlert(alertId:$alertId){...OrbitAlertFields}}${ALERT}`
export const DRAFT=gql`mutation WebOrbitDraft($childId:ID!,$wearColor:String,$wearGarment:String,$hair:String,$carryColor:String,$carryItem:String,$photoId:ID,$lastSeenPlaceId:ID,$lastSeenAt:String){orbitDraft(childId:$childId,wearColor:$wearColor,wearGarment:$wearGarment,hair:$hair,carryColor:$carryColor,carryItem:$carryItem,photoId:$photoId,lastSeenPlaceId:$lastSeenPlaceId,lastSeenAt:$lastSeenAt){draftId draftVersion status guidance}}`
export const PREVIEW=gql`mutation WebOrbitPreview($draftId:ID!){orbitPreview(draftId:$draftId){draftId draftVersion message messageHash audienceSize guidance}}`
export const ACTIVATE=gql`mutation WebOrbitActivate($draftId:ID!,$draftVersion:Int!,$messageHash:String!){orbitActivate(draftId:$draftId,draftVersion:$draftVersion,messageHash:$messageHash){...OrbitAlertFields}}${ALERT}`
export const RESPOND=gql`mutation WebOrbitRespond($alertId:ID!,$response:String!){orbitRespond(alertId:$alertId,response:$response){responseId}}`
export const CLOSE=gql`mutation WebOrbitClose($alertId:ID!,$outcome:String){orbitClose(alertId:$alertId,outcome:$outcome){...OrbitAlertFields}}${ALERT}`
export function createOrbitAdapter(client:ReturnType<typeof createGraphClient>,read:<T>(fn:()=>Promise<T>)=>Promise<T>,getToken:()=>string|undefined):OrbitAdapter{
 async function query<T>(document:typeof CHECK,variables:Record<string,unknown>,field:string):Promise<T>{return read(async()=>{const result=await client.query<Record<string,T>>({query:document,variables,fetchPolicy:'no-cache'});if(!result.data||result.data[field]===undefined)throw Error('READ_UNAVAILABLE');return result.data[field]})}
 // These are mutations even when called "preview". Never pass through the read/401 retry path.
 async function mutate<T>(document:typeof CHECK,variables:Record<string,unknown>,field:string):Promise<T>{const result=await client.mutate<Record<string,T>>({mutation:document,variables,fetchPolicy:'no-cache'});if(!result.data||result.data[field]===undefined)throw Error('ACTION_UNAVAILABLE');return result.data[field]}
 async function media(path:string,options:RequestInit){const token=getToken();if(!token)throw Error('UNAUTHENTICATED');const response=await fetch(path,{...options,cache:'no-store',headers:{...options.headers,Authorization:`Bearer ${token}`}});if(!response.ok)throw Error(response.status===401?'UNAUTHENTICATED':response.status===404?'PHOTO_NOT_SHARED':'PHOTO_UNAVAILABLE');return response}
 return{
  places:childId=>query(PLACES,{childId},'orbitPlaces'),check:childId=>query(CHECK,{childId},'checkInStatus'),vocabulary:()=>query(VOCABULARY,{},'orbitVocabulary'),status:(childId,alertId)=>query(STATUS,{childId,alertId},'orbitStatus'),alert:alertId=>query(READ_ALERT,{alertId},'orbitAlert'),
  draft:(childId,values,photoId,lastSeen)=>mutate(DRAFT,{childId,...values,...(photoId?{photoId}:{}),...lastSeen},'orbitDraft'),preview:draftId=>mutate(PREVIEW,{draftId},'orbitPreview'),activate:p=>mutate(ACTIVATE,{draftId:p.draftId,draftVersion:p.draftVersion,messageHash:p.messageHash},'orbitActivate'),respond:async(alertId,response)=>{await mutate(RESPOND,{alertId,response},'orbitRespond')},close:(alertId,outcome)=>mutate(CLOSE,{alertId,outcome},'orbitClose'),
  upload:async(childId,file,signal)=>{if(!['image/jpeg','image/png'].includes(file.type)||file.size>8*1024*1024)throw Error('PHOTO_FILE_INVALID');const r=await media(`/api/orbit/photo?childId=${encodeURIComponent(childId)}`,{method:'POST',body:file,headers:{'Content-Type':file.type},signal});const body=await r.json() as {photoId?:unknown};if(typeof body.photoId!=='string')throw Error('PHOTO_UNAVAILABLE');return body.photoId},
  photo:(id,signal)=>read(async()=>{const r=await media(`/api/orbit/photo/${encodeURIComponent(id)}`,{signal});return r.blob()}),
 }
}
export function orbitError(error:unknown):string{
 const e=error as {message?:string;errors?:{message?:string;extensions?:{code?:string}}[]}
 const text=[e?.message,...(e?.errors??[]).flatMap(x=>[x.message,x.extensions?.code])].join(' ')
 if(/ORBIT_PLACE_NOT_YOURS/.test(text))return 'Choose a place shared with this child.'
 if(/ORBIT_DRAFT_STALE|ORBIT_PREVIEW_MISMATCH/.test(text))return 'The draft changed. Review it again.'
 if(/DEMO_GUIDE_READ_ONLY/.test(text))return 'This action is available only in the showcase family'
 if(/UNAUTHORIZED|PHOTO_NOT_SHARED/.test(text))return "This isn't shared with you."
 if(/UNAUTHENTICATED/.test(text))return 'Your perspective needs refreshing. Try this action again.'
 if(/ORBIT_ALREADY_ACTIVE/.test(text))return 'An Orbit alert is already active. Refresh to see its recorded state.'
 if(/ORBIT_VALUE_NOT_IN_VOCAB/.test(text))return 'Choose a description from the available options.'
 if(/ORBIT_NO_AUDIENCE/.test(text))return 'No approved village audience is recorded for this view.'
 if(/ORBIT_NOT_ACTIVE/.test(text))return 'This alert is no longer active. Refresh to see its recorded state.'
 if(/PHOTO_FILE_INVALID/.test(text))return 'Choose a JPEG or PNG photo no larger than 8 MB.'
 if(/ORBIT_PHOTO_NOT_YOURS|ORBIT_PHOTO_IMMUTABLE/.test(text))return 'Choose a new photo shared with this perspective.'
 if(/ORBIT_SHARE_HAS_LOCATION/.test(text))return 'Use only the provided description options.'
 if(/ORBIT_RESPONSES_APPEND_ONLY/.test(text))return 'Previous responses stay recorded. Choose a new response.'
 return "Couldn't complete this just now. Review the recorded state before trying again."
}
