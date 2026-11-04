import {ApolloClient,ApolloLink,InMemoryCache,Observable} from '@apollo/client'
import {expect,it} from 'vitest'
import {readSignatureVillage} from './villageRead'
it('projects only returned people and recorded child-specific relationships, without deriving authority',async()=>{
 const client=new ApolloClient({cache:new InMemoryCache(),link:new ApolloLink(()=>new Observable(observer=>{observer.next({data:{child:{person:{id:'child',displayName:'Child'}},householdMembers:[{person:{id:'parent',displayName:'Parent'},role:'parent'}],relationships:[{id:'rel',from:{id:'parent',displayName:'Parent'},to:{id:'child'},type:'parent',status:'ACTIVE'},{id:'other-rel',from:{id:'not-shared',displayName:'Other'},to:{id:'other-child'},type:'sitter',status:'ACTIVE'}]}});observer.complete()}))})
 const scene=await readSignatureVillage(client,'child',fn=>fn());expect(scene.people).toEqual([{id:'parent',name:'Parent',relationship:'parent',group:'Household',relationshipStatus:'ACTIVE'}]);expect(scene.people[0].authorityLabel).toBeUndefined();expect(scene.child.id).toBe('child');client.stop()
})
it('a hidden/null child remains a refusal; it never substitutes a fixture child',async()=>{
 const client=new ApolloClient({cache:new InMemoryCache(),link:new ApolloLink(()=>new Observable(observer=>{observer.next({data:{child:null,householdMembers:[],relationships:[]}});observer.complete()}))});await expect(readSignatureVillage(client,'hidden',fn=>fn())).rejects.toThrow('UNAUTHORIZED');client.stop()
})
it('keeps distinct recorded statuses for multiple roles and assigns a stable documented group',async()=>{
 const edges=[{id:'two',from:{id:'person',displayName:'Person'},to:{id:'child'},type:'sitter',status:'DISCOVERED'},{id:'one',from:{id:'person',displayName:'Person'},to:{id:'child'},type:'aunt',status:'ACTIVE'}]
 let reversed=false;const client=new ApolloClient({cache:new InMemoryCache(),link:new ApolloLink(()=>new Observable(observer=>{observer.next({data:{child:{person:{id:'child',displayName:'Child'}},householdMembers:[],relationships:reversed?[...edges].reverse():edges}});observer.complete()}))});const first=await readSignatureVillage(client,'child',fn=>fn());reversed=true;const second=await readSignatureVillage(client,'child',fn=>fn());expect(first.people[0].relationshipStatus).toBeUndefined();expect(first.people[0].relationshipDetails).toEqual([{type:'aunt',status:'ACTIVE'},{type:'sitter',status:'DISCOVERED'}]);expect(first.people[0].group).toBe('Family');expect(second.people).toEqual(first.people);client.stop()
})
