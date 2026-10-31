import {gql,type ApolloClient} from '@apollo/client'
import {relationshipGroup,relationshipLabel} from './layout'
import type {VillageChild,VillagePerson} from './types'
export const SIGNATURE_VILLAGE=gql`query WebSignatureVillage($childId:ID!){child(id:$childId){person{id displayName}} householdMembers(childId:$childId){person{id displayName} role} relationships(childId:$childId){id from{id displayName} to{id} type status}}`
type Person={id:string;displayName:string}
type VillageRead={child:{person:Person|null}|null;householdMembers:{person:Person;role:string}[];relationships:{id:string;from:Person;to:{id:string};type:string;status:string}[]}
export type VillageScene={child:VillageChild;people:VillagePerson[]}
export async function readSignatureVillage(client:ApolloClient,childId:string,runRead:<T>(read:()=>Promise<T>)=>Promise<T>,signal?:AbortSignal):Promise<VillageScene>{
 const data=await runRead(async()=>{const result=await client.query<VillageRead>({query:SIGNATURE_VILLAGE,variables:{childId},fetchPolicy:'no-cache',context:{fetchOptions:{signal}}});if(!result.data)throw Error('READ_UNAVAILABLE');return result.data})
 if(!data.child?.person)throw Error('UNAUTHORIZED')
 const people=new Map<string,VillagePerson>()
 for(const member of data.householdMembers){if(member.person.id!==childId)people.set(member.person.id,{id:member.person.id,name:member.person.displayName,relationship:`Household ${relationshipLabel(member.role)}`,group:'Household'})}
 for(const edge of data.relationships){if(edge.to.id!==childId||edge.from.id===childId)continue;const prior=people.get(edge.from.id);people.set(edge.from.id,{id:edge.from.id,name:edge.from.displayName,relationship:prior&&prior.group!=='Household'?`${prior.relationship}, ${relationshipLabel(edge.type)}`:relationshipLabel(edge.type),group:relationshipGroup(edge.type),relationshipStatus:edge.status})}
 return {child:{id:data.child.person.id,name:data.child.person.displayName},people:[...people.values()]}
}
