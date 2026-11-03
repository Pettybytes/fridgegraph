import {gql,type ApolloClient,type DocumentNode} from '@apollo/client'
import type {FridgeEditingAdapter,GoalRecord,FridgeNoteRecord} from './editingContract'

export type Phase2Failure='authentication'|'refused'|'network'|'database'|'server'|'failed'
export type Compatibility={kind:'ready'|'absent'}|{kind:Phase2Failure}
// A read-only compatibility read. Every field resolves, so the router can plan it: a
// selection whose fields are ALL skipped produces an empty query plan, which Apollo
// Router v2.18.0 answers with HTTP 500 `empty query plan` (measured in the CP6 window).
// Nothing here writes; the resolved shape is the only signal, never the resolver side effect.
export const FRIDGE_COMPATIBILITY=gql`query FridgePhase2Compatibility($childId:ID!){
 __typename
 goals(childId:$childId){id period completedAt}
 fridgeNotes(childId:$childId){id text paperColor audience revision createdAt updatedAt author{id displayName}}
}`
const goal='id title horizon status period completedAt'
const note='id text paperColor audience createdAt updatedAt revision author{id displayName}'
export const phase2Operations={
 readGoals:gql`query FridgeEditableGoals($childId:ID!){goals(childId:$childId){${goal}}}`,
 readNotes:gql`query FridgePostedNotes($childId:ID!){fridgeNotes(childId:$childId){${note}}}`,
 createGoal:gql`mutation FridgeCreateGoal($childId:ID!,$title:String!,$horizon:String,$period:GoalPeriod,$status:GoalStatus){createGoal(childId:$childId,title:$title,horizon:$horizon,period:$period,status:$status){${goal}}}`,
 updateGoal:gql`mutation FridgeUpdateGoal($id:ID!,$title:String,$horizon:String,$period:GoalPeriod){updateGoal(id:$id,title:$title,horizon:$horizon,period:$period){${goal}}}`,
 completeGoal:gql`mutation FridgeCompleteGoal($id:ID!){completeGoal(id:$id){${goal}}}`,
 uncompleteGoal:gql`mutation FridgeReopenGoal($id:ID!){uncompleteGoal(id:$id){${goal}}}`,
 deleteGoal:gql`mutation FridgeDeleteGoal($id:ID!){deleteGoal(id:$id)}`,
 postFridgeNote:gql`mutation FridgePostNote($childId:ID!,$text:String!,$paperColor:PaperColor,$audience:FridgeNoteAudience){postFridgeNote(childId:$childId,text:$text,paperColor:$paperColor,audience:$audience){${note}}}`,
 updateFridgeNote:gql`mutation FridgeUpdateNote($id:ID!,$text:String,$paperColor:PaperColor){updateFridgeNote(id:$id,text:$text,paperColor:$paperColor){${note}}}`,
 setFridgeNoteAudience:gql`mutation FridgeShareNote($id:ID!,$audience:FridgeNoteAudience!){setFridgeNoteAudience(id:$id,audience:$audience){${note}}}`,
 removeFridgeNote:gql`mutation FridgeRemoveNote($id:ID!){removeFridgeNote(id:$id)}`,
}
type GraphError={message?:string;extensions?:{code?:string}}
function graphErrors(error:unknown):GraphError[]{const e=error as {errors?:GraphError[];graphQLErrors?:GraphError[];result?:{errors?:GraphError[]}};return e?.errors??e?.graphQLErrors??e?.result?.errors??[]}
export function phase2Failure(error:unknown):Phase2Failure{
 const codes=graphErrors(error).map(e=>e.extensions?.code)
 const e=error as {message?:string;statusCode?:number;networkError?:{statusCode?:number}}
 const status=e?.statusCode??e?.networkError?.statusCode
 const message=e?.message??''
 if(status===401||codes.includes('UNAUTHENTICATED')||message==='UNAUTHENTICATED')return 'authentication'
 if(status===403||codes.some(c=>['UNAUTHORIZED','FORBIDDEN','DEMO_GUIDE_READ_ONLY','FRIDGE_NOTE_AUDIENCE_LOCKED'].includes(c??''))||/^(UNAUTHORIZED|FORBIDDEN|DEMO_GUIDE_READ_ONLY)$/.test(message))return 'refused'
 if(codes.some(c=>c==='DB_UNAVAILABLE')||message==='DB_UNAVAILABLE')return 'database'
 // 5xx is a server fault, not a transport loss: keep it out of `network`.
 if(codes.includes('INTERNAL_SERVER_ERROR')||(typeof status==='number'&&status>=500))return 'server'
 if(e?.networkError||status||error instanceof TypeError||message==='NETWORK_ERROR')return 'network'
 return 'failed'
}
export function missingPhase2Schema(error:unknown):boolean{
 const errors=graphErrors(error)
 // All errors must be known validation failures for fields used in this probe.
 // Missing DB columns, generic validation and mixed auth/errors NEVER mean old schema.
 return errors.length>0&&errors.every(e=>e.extensions?.code==='GRAPHQL_VALIDATION_FAILED'&&
  (/Cannot query field "(?:period|completedAt)" on type "Goal"/.test(e.message??'')||/Cannot query field "fridgeNotes" on type "Query"/.test(e.message??'')))
}
export const phase2Message:Record<Phase2Failure,string>={authentication:'Your perspective needs a fresh session. Choose a perspective again.',refused:'These records aren’t shared with this perspective.',network:'Couldn’t connect just now. Try again.',database:'Couldn’t load these records just now. Try again.',server:'The fridge service answered with an error. Try again.',failed:'Couldn’t load these records. Try again.'}
export type Phase2Service={check(childId:string,signal:AbortSignal):Promise<Compatibility>;adapter:FridgeEditingAdapter}
export function createPhase2Service(client:ApolloClient,runRead:<T>(read:()=>Promise<T>)=>Promise<T>,writesEnabled:()=>boolean):Phase2Service{
 const read=async<T,>(query:DocumentNode,variables:Record<string,unknown>,field:string,signal:AbortSignal):Promise<T>=>{
  try{const result=await runRead(()=>client.query<Record<string,T>>({query,variables,fetchPolicy:'no-cache',errorPolicy:'none',context:{fetchOptions:{signal}}}));if(!result.data||result.data[field]==null)throw Error('NO_DATA');return result.data[field]}
  catch(error){if(signal.aborted)throw error;throw Error(({authentication:'UNAUTHENTICATED',refused:'UNAUTHORIZED',network:'NETWORK_ERROR',database:'DB_UNAVAILABLE',server:'SERVER_ERROR',failed:'READ_FAILED'} as const)[phase2Failure(error)])}
 }
 const write=async<T,>(name:keyof typeof phase2Operations,args:object):Promise<T>=>{
  if(!writesEnabled())throw Error('UNAUTHORIZED')
  try{const result=await client.mutate<Record<string,T>>({mutation:phase2Operations[name],variables:args,errorPolicy:'none',fetchPolicy:'no-cache'});if(!result.data||result.data[name]==null)throw Error('NO_DATA');return result.data[name]}
  catch(error){throw Error(({authentication:'UNAUTHENTICATED',refused:'UNAUTHORIZED',network:'NETWORK_ERROR',database:'DB_UNAVAILABLE',server:'SERVER_ERROR',failed:'WRITE_FAILED'} as const)[phase2Failure(error)])}
 }
 return {async check(childId,signal){try{
  const result=await runRead(()=>client.query({query:FRIDGE_COMPATIBILITY,variables:{childId},fetchPolicy:'no-cache',errorPolicy:'none',context:{fetchOptions:{signal}}}))
  if(signal.aborted)throw Error('ABORTED')
  const data=result.data as {__typename?:unknown;goals?:unknown;fridgeNotes?:unknown}|null|undefined
  // Success needs the whole shape: both collections resolved to arrays (empty is valid).
  // errorPolicy 'none' means any GraphQL error already threw, so partial data never reaches here.
  if(!data||data.__typename!=='Query'||!Array.isArray(data.goals)||!Array.isArray(data.fridgeNotes))throw Error('MALFORMED')
  return {kind:'ready'}
 }catch(error){if(signal.aborted)throw error;return {kind:missingPhase2Schema(error)?'absent':phase2Failure(error)}}},adapter:{
  readGoals:(id,signal)=>read<GoalRecord[]>(phase2Operations.readGoals,{childId:id},'goals',signal),
  readNotes:(id,signal)=>read<FridgeNoteRecord[]>(phase2Operations.readNotes,{childId:id},'fridgeNotes',signal),
  createGoal:args=>write('createGoal',args),updateGoal:args=>write('updateGoal',args),completeGoal:args=>write('completeGoal',args),uncompleteGoal:args=>write('uncompleteGoal',args),deleteGoal:args=>write('deleteGoal',args),
  postFridgeNote:args=>write('postFridgeNote',args),updateFridgeNote:args=>write('updateFridgeNote',args),setFridgeNoteAudience:args=>write('setFridgeNoteAudience',args),removeFridgeNote:args=>write('removeFridgeNote',args),
 }}
}
