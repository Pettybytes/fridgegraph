import {expect,it,vi} from 'vitest'
import {buildSchema,execute,validate,NoSchemaIntrospectionCustomRule,print} from 'graphql'
import {InMemoryCache,type ApolloClient} from '@apollo/client'
import {createPhase2Service,FRIDGE_COMPATIBILITY,missingPhase2Schema,phase2Failure} from './phase2Adapter'
import {createFridgeReader} from './reader'
const graphError=(code:string,message:string)=>Object.assign(Error(message),{errors:[{message,extensions:{code}}]})
const run=<T,>(f:()=>Promise<T>)=>f()
it('plans and executes a non-mutating compatibility read instead of skipping every field',async()=>{
 const schema=buildSchema('type Query{goals(childId:ID!):[Goal!]! fridgeNotes(childId:ID!):[FridgeNote!]!} type Goal{id:ID period:String completedAt:String} type FridgeNote{id:ID text:String paperColor:String audience:String revision:Int createdAt:String updatedAt:String author:Person} type Person{id:ID displayName:String}')
 expect(validate(schema,FRIDGE_COMPATIBILITY,[NoSchemaIntrospectionCustomRule])).toEqual([])
 // A fully-skipped selection is an empty query plan on Apollo Router (500). The probe
 // must therefore carry resolvable fields; this asserts the regression cannot return.
 expect(print(FRIDGE_COMPATIBILITY)).not.toMatch(/@skip/)
 const goals=vi.fn(()=>[{id:'g',period:null,completedAt:null}]),fridgeNotes=vi.fn(()=>[])
 expect(await execute({schema,document:FRIDGE_COMPATIBILITY,variableValues:{childId:'child'},rootValue:{goals,fridgeNotes}})).toEqual({data:{__typename:'Query',goals:[{id:'g',period:null,completedAt:null}],fridgeNotes:[]}})
 expect(goals).toHaveBeenCalledTimes(1);expect(fridgeNotes).toHaveBeenCalledTimes(1)
 expect(print(FRIDGE_COMPATIBILITY)).not.toMatch(/__schema|__type\(/)
})
it('recognizes only known missing-schema validation failures, including with introspection disabled',async()=>{
 const legacy=buildSchema('type Query{goals(childId:ID!):[Goal!]!} type Goal{id:ID title:String horizon:String status:String}')
 const errors=validate(legacy,FRIDGE_COMPATIBILITY).map(error=>({message:error.message,extensions:{code:'GRAPHQL_VALIDATION_FAILED'}}))
 expect(missingPhase2Schema({errors})).toBe(true)
 for(const error of [graphError('DB_UNAVAILABLE','column period does not exist'),graphError('UNAUTHORIZED','Cannot query field "fridgeNotes" on type "Query".'),graphError('GRAPHQL_VALIDATION_FAILED','Unknown directive "other".'),{errors:[...errors,{message:'Denied',extensions:{code:'UNAUTHORIZED'}}]}])expect(missingPhase2Schema(error)).toBe(false)
})
it.each([
 ['UNAUTHENTICATED','authentication'],['UNAUTHORIZED','refused'],['DB_UNAVAILABLE','database'],['INTERNAL_SERVER_ERROR','server'],
] as const)('retains %s separately from an older schema',async(code,kind)=>{
 const client={cache:new InMemoryCache(),onClearStore:()=>()=>{},query:vi.fn().mockRejectedValue(graphError(code,'sanitized upstream error')),mutate:vi.fn()}
 const service=createPhase2Service(client as unknown as ApolloClient,run,()=>true)
 expect(await service.check('c',new AbortController().signal)).toEqual({kind})
 expect(client.mutate).not.toHaveBeenCalled()
})
it('retains network failure and HTTP authentication separately',()=>{
 expect(phase2Failure(new TypeError('Failed to fetch'))).toBe('network')
 expect(phase2Failure({statusCode:401})).toBe('authentication')
 expect(phase2Failure({statusCode:503})).toBe('server')
})
it('leaves Phase 1 queries independent and readable when compatibility fails',async()=>{
 const query=vi.fn().mockRejectedValueOnce(graphError('GRAPHQL_VALIDATION_FAILED','Cannot query field "period" on type "Goal".')).mockResolvedValueOnce({data:{goals:[{id:'g',title:'Original goal',horizon:'Whenever',status:'APPROVED'}]}})
 const client={cache:new InMemoryCache(),onClearStore:()=>()=>{},query,mutate:vi.fn()} as unknown as ApolloClient
 expect(await createPhase2Service(client,run,()=>false).check('c',new AbortController().signal)).toEqual({kind:'absent'})
 expect(await createFridgeReader(client,run).read('goals','c',new AbortController().signal)).toMatchObject({status:'ready'})
 expect(print(query.mock.calls[1][0].query)).not.toMatch(/completedAt|period|fridgeNotes/)
})
it('never writes before deployment enablement and never retries a mutation',async()=>{
 const mutate=vi.fn().mockRejectedValue(graphError('UNAUTHENTICATED','expired')),readRetry=vi.fn(run) as typeof run & ReturnType<typeof vi.fn>,client={mutate,query:vi.fn()}
 const blocked=createPhase2Service(client as unknown as ApolloClient,readRetry,()=>false)
 await expect(blocked.adapter.completeGoal({id:'g'})).rejects.toThrow('UNAUTHORIZED');expect(mutate).not.toHaveBeenCalled()
 const ready=createPhase2Service(client as unknown as ApolloClient,readRetry,()=>true)
 await expect(ready.adapter.completeGoal({id:'g'})).rejects.toThrow('UNAUTHENTICATED');expect(mutate).toHaveBeenCalledTimes(1);expect(readRetry).not.toHaveBeenCalled()
})
it('sends exact content and separate explicit sharing operations through the existing client',async()=>{
 const mutate=vi.fn().mockResolvedValueOnce({data:{postFridgeNote:{id:'n',audience:'PARENTS_ONLY'}}}).mockResolvedValueOnce({data:{setFridgeNoteAudience:{id:'n',audience:'SHARED'}}})
 const adapter=createPhase2Service({mutate} as unknown as ApolloClient,run,()=>true).adapter
 await adapter.postFridgeNote({childId:'c',text:'Note',paperColor:'PINK',audience:'PARENTS_ONLY'})
 expect(mutate.mock.calls[0][0].variables).toEqual({childId:'c',text:'Note',paperColor:'PINK',audience:'PARENTS_ONLY'})
 expect(print(mutate.mock.calls[0][0].mutation)).not.toMatch(/authorId/)
 expect(print(mutate.mock.calls[0][0].mutation)).toContain('attachmentRef: $attachmentRef')
 await adapter.setFridgeNoteAudience({id:'n',audience:'SHARED'})
 expect(mutate.mock.calls[1][0].variables).toEqual({id:'n',audience:'SHARED'})
})
it('reports ready only when both collections resolve to arrays, populated or empty',async()=>{
 const populated={cache:new InMemoryCache(),onClearStore:()=>()=>{},query:vi.fn().mockResolvedValue({data:{__typename:'Query',goals:[{id:'g',period:'WEEK',completedAt:null}],fridgeNotes:[{id:'n',text:'t',paperColor:'PINK',audience:'PARENTS_ONLY',revision:1,createdAt:'x',updatedAt:'x',author:{id:'p',displayName:'K'}}]}}),mutate:vi.fn()}
 expect(await createPhase2Service(populated as unknown as ApolloClient,run,()=>true).check('c',new AbortController().signal)).toEqual({kind:'ready'})
 const empty={cache:new InMemoryCache(),onClearStore:()=>()=>{},query:vi.fn().mockResolvedValue({data:{__typename:'Query',goals:[],fridgeNotes:[]}}),mutate:vi.fn()}
 expect(await createPhase2Service(empty as unknown as ApolloClient,run,()=>true).check('c',new AbortController().signal)).toEqual({kind:'ready'})
})
it.each([
 ['null data',{data:null}],
 ['missing notes field',{data:{__typename:'Query',goals:[]}}],
 ['null notes',{data:{__typename:'Query',goals:[],fridgeNotes:null}}],
 ['object instead of array',{data:{__typename:'Query',goals:{},fridgeNotes:[]}}],
 ['wrong root typename',{data:{__typename:'Mutation',goals:[],fridgeNotes:[]}}],
] as const)('never reports ready for %s',async(_label,result)=>{
 const client={cache:new InMemoryCache(),onClearStore:()=>()=>{},query:vi.fn().mockResolvedValue(result),mutate:vi.fn()}
 const state=await createPhase2Service(client as unknown as ApolloClient,run,()=>true).check('c',new AbortController().signal)
 expect(state.kind).not.toBe('ready')
})
it('never treats a mixed validation-and-auth error set as an older backend',async()=>{
 const errors=[{message:'Cannot query field "period" on type "Goal".',extensions:{code:'GRAPHQL_VALIDATION_FAILED'}},{message:'Denied',extensions:{code:'UNAUTHORIZED'}}]
 const client={cache:new InMemoryCache(),onClearStore:()=>()=>{},query:vi.fn().mockRejectedValue({errors}),mutate:vi.fn()}
 expect(await createPhase2Service(client as unknown as ApolloClient,run,()=>true).check('c',new AbortController().signal)).toEqual({kind:'refused'})
})
it('discards a compatibility result once the caller aborts on a persona or child switch',async()=>{
 const controller=new AbortController()
 const client={cache:new InMemoryCache(),onClearStore:()=>()=>{},query:vi.fn().mockImplementation(async()=>{controller.abort();return {data:{__typename:'Query',goals:[],fridgeNotes:[]}}}),mutate:vi.fn()}
 await expect(createPhase2Service(client as unknown as ApolloClient,run,()=>true).check('c',controller.signal)).rejects.toThrow()
})
