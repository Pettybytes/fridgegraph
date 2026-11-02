import {expect,it,vi} from 'vitest'
import {createDeliveredRouteTransport,createLiveMapAdapter,mapRouteError,routeRequestKey,routingProfiles,type MapSession,type RouteTransport,type RouteWire} from './liveAdapter'
import {MapController} from './controller'
import {personPoint} from './model'
import type {MapWorld,Mode} from './types'
const wire:RouteWire={distanceMeters:1609.344,durationSeconds:300,geometry:{type:'LineString',coordinates:[[-83,42],[-83.1,42.1]]},source:'openrouteservice',cached:false,disclaimer:'Estimated — not live traffic'}
// Controlled wire-independent projection, not claimed as a seeded place or delivered world read.
const world:MapWorld={state:'live',people:[{id:'person-a',name:'Authorized Person',position:{source:'event',placeId:'rp_origin',label:'Returned venue label',addressRead:false},vehicle:'unknown'}],places:[{id:'rp_origin',name:'Returned venue label',kind:'venue',point:[-83,42],addressRead:false},{id:'rp_destination',name:'Backend school label',kind:'school',point:[-83.1,42.1],addressRead:false}],events:[],days:['2026-11-03'],canApprove:true,canReadCost:true,parentName:'Parent'}
function setup(transport?:RouteTransport){
 let session:MapSession|null={generation:1,childId:'child-a',accessToken:'test-only-session-a'}
 const adapter=createLiveMapAdapter({getSession:()=>session,readWorld:async()=>structuredClone(world),...(transport?{transport}:{})})
 return {adapter,setSession:(s:MapSession|null)=>{session=s}}
}
it('uses the documented ID-only proxy with an explicit profile and current bearer, never coordinates',async()=>{
 const request=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(wire),{status:200}))
 const {adapter,setSession}=setup(createDeliveredRouteTransport(request));await adapter.readWorld()
 await adapter.route('person-a','rp_destination','Drive')
 setSession({generation:1,childId:'child-a',accessToken:'test-only-session-renewed'})
 await adapter.route('person-a','rp_destination','Drive')
 expect(request).toHaveBeenCalledTimes(2) // Completed results never bypass server authorization.
 expect(request.mock.calls[0][0]).toBe('/api/village/route')
 expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toEqual({childId:'child-a',fromPlaceId:'rp_origin',toPlaceId:'rp_destination',profile:'driving-car'})
 expect(request.mock.calls[1][1]!.headers).toMatchObject({Authorization:'Bearer test-only-session-renewed'})
})
it('sends distinct Walk and Bike profiles to the delivered proxy',async()=>{
 const request=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(wire),{status:200})),{adapter}=setup(createDeliveredRouteTransport(request));await adapter.readWorld()
 await adapter.route('person-a','rp_destination','Walk')
 await adapter.route('person-a','rp_destination','Bike')
 expect(request.mock.calls.map(call=>JSON.parse(call[1]!.body as string).profile)).toEqual(['foot-walking','cycling-regular'])
 expect(mapRouteError(Error('MODE_UNSUPPORTED'))).toBe('This travel mode is not supported yet.')
})
it('routes between two shared places without assigning a location to an unlocated person',async()=>{
 const request=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(wire),{status:200}))
 const {adapter}=setup(createDeliveredRouteTransport(request));await adapter.readWorld()
 const result=await adapter.route('place:rp_origin','rp_destination','Walk')
 expect(result).toMatchObject({fromId:'place:rp_origin',toId:'rp_destination',mode:'Walk',rideEstimate:null})
 expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toEqual({childId:'child-a',fromPlaceId:'rp_origin',toPlaceId:'rp_destination',profile:'foot-walking'})
 await expect(adapter.route('place:missing','rp_destination','Drive')).rejects.toThrow('NOT_FOUND')
})
it('isolates each profile in its own in-flight cache entry and retains mode-specific outputs',async()=>{
 const request=vi.fn<RouteTransport['request']>(async input=>({...wire,durationSeconds:input.profile==='driving-car'?300:input.profile==='foot-walking'?1800:600}))
 const {adapter}=setup({supportedProfiles:Object.values(routingProfiles),request});await adapter.readWorld()
 const modes:Mode[]=['Drive','Walk','Bike']
 const results=await Promise.all(modes.map(mode=>adapter.route('person-a','rp_destination',mode)))
 expect(request.mock.calls.map(c=>c[0].profile)).toEqual(['driving-car','foot-walking','cycling-regular'])
 expect(results.map(r=>[r.mode,r.durationSeconds])).toEqual([['Drive',300],['Walk',1800],['Bike',600]])
 expect(new Set(results.map(r=>r.id)).size).toBe(3)
 const input={childId:'child-a',fromPlaceId:'rp_origin',toPlaceId:'rp_destination',profile:'driving-car' as const}
 expect(routeRequestKey(1,input)).not.toBe(routeRequestKey(2,input))
})
it('keeps backend IDs/labels, refuses fixtures and never invents ride cost or approval authority',async()=>{
 const {adapter}=setup({supportedProfiles:['driving-car'],request:async()=>wire})
 expect((await adapter.readWorld()).places).toEqual(world.places)
 expect((await adapter.readWorld()).canApprove).toBe(false)
 expect((await adapter.readWorld()).canReadCost).toBe(false)
 expect(await adapter.route('person-a','rp_destination','Drive')).toMatchObject({state:'live',rideEstimate:null,distanceMiles:1})
 const mock=createLiveMapAdapter({getSession:()=>({generation:1,childId:'x',accessToken:'test-only-session'}),readWorld:async()=>({...world,state:'mock'})})
 await expect(mock.readWorld()).rejects.toThrow('WORLD_READ_UNAVAILABLE')
 const pending=createLiveMapAdapter({getSession:()=>({generation:1,childId:'x',accessToken:'test-only-session'})})
 await expect(pending.readWorld()).rejects.toThrow('WORLD_READ_UNAVAILABLE')
})
it('withheld coordinates stay label-only even with stale person coordinates',async()=>{
 const request=vi.fn(),restricted={...world,places:world.places.map(({point:_,...p})=>p),people:world.people.map(p=>({...p,position:{...p.position,point:[-83,42] as [number,number]}}))}
 const adapter=createLiveMapAdapter({getSession:()=>({generation:1,childId:'x',accessToken:'test-only-session'}),readWorld:async()=>restricted,transport:{supportedProfiles:['driving-car'],request}})
 const read=await adapter.readWorld()
 expect(read.places.map(p=>p.name)).toEqual(['Returned venue label','Backend school label'])
 expect(read.places.every(p=>!p.point)).toBe(true);expect(personPoint(read.people[0],read)).toBeUndefined()
 await expect(adapter.route('person-a','rp_destination','Drive')).rejects.toThrow('COORDINATES_WITHHELD')
 expect(request).not.toHaveBeenCalled()
})
it.each([[401,'UNAUTHENTICATED'],[403,'COORDINATES_WITHHELD'],[404,'NOT_FOUND'],[409,'GEOMETRY_UNAVAILABLE'],[429,'RATE_LIMITED'],[503,'ROUTE_UNAVAILABLE']] as const)('preserves the %s refusal/outcome without leaking server content',async(status,code)=>{
 const request=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({error:code,place:'Must not leak',detail:'internal'}),{status}))
 const transport=createDeliveredRouteTransport(request)
 await expect(transport.request({childId:'x',fromPlaceId:'a',toPlaceId:'b',profile:'driving-car'},'test-only-session',new AbortController().signal)).rejects.toThrow(code)
 expect(request).toHaveBeenCalledTimes(1);expect(mapRouteError(Error(code))).not.toMatch(/Must not leak|internal|503/)
})
it('rejects incomplete geometry instead of creating a straight-line route',async()=>{
 const transport=createDeliveredRouteTransport(vi.fn(async()=>new Response(JSON.stringify({...wire,geometry:{type:'LineString',coordinates:[]}}))))
 await expect(transport.request({childId:'x',fromPlaceId:'a',toPlaceId:'b',profile:'driving-car'},'test-only-session',new AbortController().signal)).rejects.toThrow('ROUTE_UNAVAILABLE')
})
it('discards late route and world reads on perspective switch and aborts on disposal',async()=>{
 let resolve!:(r:RouteWire)=>void,signal:AbortSignal|undefined
 const {adapter,setSession}=setup({supportedProfiles:['driving-car'],request:(_,__,s)=>{signal=s;return new Promise(r=>{resolve=r})}})
 await adapter.readWorld();const pending=adapter.route('person-a','rp_destination','Drive')
 setSession({generation:2,childId:'other-child',accessToken:'test-only-other'});resolve(wire)
 await expect(pending).rejects.toMatchObject({name:'AbortError'})
 adapter.dispose();expect(signal?.aborted).toBe(true)
 let finish!:(w:MapWorld)=>void;let generation=1
 const other=createLiveMapAdapter({getSession:()=>({generation,childId:'x',accessToken:'test-only-session'}),readWorld:()=>new Promise(r=>{finish=r})})
 const read=other.readWorld();generation=2;finish(world);await expect(read).rejects.toMatchObject({name:'AbortError'})
})
it('switching modes during a pending route never renders the old result under the new label',async()=>{
 const pending=new Map<string,(r:RouteWire)=>void>()
 const {adapter}=setup({supportedProfiles:Object.values(routingProfiles),request:input=>new Promise(r=>pending.set(input.profile,r))})
 const c=new MapController(adapter);await c.load();const first=c.route('person-a','rp_destination','Drive')
 c.setMode('Walk');expect(c.getSnapshot()).toMatchObject({mode:'Walk',routing:true,route:null})
 pending.get('driving-car')!(wire);await first;expect(c.getSnapshot().route).toBeNull()
 pending.get('foot-walking')!({...wire,durationSeconds:1800})
 await vi.waitFor(()=>expect(c.getSnapshot().route).toMatchObject({mode:'Walk',durationSeconds:1800}))
 expect(c.getSnapshot().proposal).toBe('none');c.dispose()
})
