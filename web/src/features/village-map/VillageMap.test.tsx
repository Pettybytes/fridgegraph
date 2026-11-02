import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {MapView} from './VillageMap'
import {MapController} from './controller'
import {createMockMapAdapter,sampleRide} from './mockAdapter'
import {mapCalendar} from './calendar'
vi.mock('./MapCanvas',()=>({MapCanvas:()=> <div>Map canvas</div>}))
vi.mock('./useMapReducedMotion',()=>({useReducedMotion:()=>true}))
afterEach(cleanup)
it('dragging onto an event requests a route, never approval; accessible pickers use the same request',async()=>{
 const adapter=createMockMapAdapter('kendra'),route=vi.spyOn(adapter,'route'),controller=new MapController(adapter);await controller.load();render(<MapView controller={controller}/>);
 const event=screen.getByText('School pickup').closest('li')!;fireEvent.drop(event,{dataTransfer:{getData:()=> 'p_gma'}});
 await screen.findByRole('region',{name:'Route estimate'});expect(route).toHaveBeenCalledWith('p_gma','school','Drive',expect.any(AbortSignal));expect(controller.getSnapshot().proposal).toBe('none');expect(screen.getByText(/Over Kendra's/)).toHaveTextContent('$10');expect(screen.getByText(/Stored sample road-distance/)).toHaveTextContent(sampleRide.basis);
 fireEvent.click(screen.getByRole('button',{name:/^Walk$/}));await waitFor(()=>expect(controller.getSnapshot().route?.mode).toBe('Walk'));expect(controller.getSnapshot().route?.rideEstimate?.amountUsd).toBe(sampleRide.amountUsd);
 fireEvent.change(screen.getByLabelText('From'),{target:{value:'p_mom'}});fireEvent.click(screen.getByRole('button',{name:'Estimate route'}));await waitFor(()=>expect(controller.getSnapshot().route?.fromId).toBe('p_mom'));expect(controller.getSnapshot().route?.rideEstimate).toBeNull();expect(controller.getSnapshot().proposal).toBe('none')
})
it('reduced motion keeps static route and explicit scrub, with arrival never completion',async()=>{const c=new MapController(createMockMapAdapter('kendra'));await c.load();await c.route('p_gma','school');c.propose();c.acceptOverCap(true);c.approve();render(<MapView controller={c}/>);expect(screen.getByRole('button',{name:'Play route preview'})).toBeDisabled();fireEvent.change(screen.getByLabelText('Route preview progress'),{target:{value:'100'}});expect(screen.getByRole('status')).toHaveTextContent('Pickup completion has not been recorded');expect(c.getSnapshot().playing).toBe(false)})
it('sample calendar and map project the exact same visible events, without inventing confirmations',async()=>{const world=await createMockMapAdapter('priya').readWorld(),calendar=mapCalendar(world),snapshot=await calendar.readCalendar({childId:'p_nora',from:'2026-11-03',to:'2026-11-03'});expect(snapshot.events.map(e=>e.id)).toEqual(world.events.filter(e=>e.day==='2026-11-03').map(e=>e.id));expect(snapshot.events[0].start).toBe(world.events.find(e=>e.id===snapshot.events[0].id)?.at);expect(snapshot.events.every(e=>e.confirmedBy.state==='missing')).toBe(true);expect(JSON.stringify(snapshot)).not.toMatch(/Kendra|Andre|home/);await expect(calendar.readCalendar({childId:'hidden',from:'2026-11-03',to:'2026-11-03'})).rejects.toThrow('UNAUTHORIZED')})
it('an unsupported persona gets a refusal without another world',async()=>{const c=new MapController(createMockMapAdapter('dana'));await c.load();render(<MapView controller={c}/>);expect(screen.getByText("This isn't shared with you.")).toBeVisible();expect(screen.queryByText('Maplewood School')).not.toBeInTheDocument()})
it('labels only mock data, keeps returned labels and blocks unwired live proposals',async()=>{
 const fixture=createMockMapAdapter('kendra')
 const live={mode:'live' as const,readWorld:async()=>({...await fixture.readWorld(),state:'live' as const,childId:'authorized-child',canApprove:false,places:(await fixture.readWorld()).places.map(p=>({...p,name:'Returned '+p.name}))}),route:async()=>({...await fixture.route('p_gma','school','Drive'),state:'live' as const,rideEstimate:null})}
 const c=new MapController(live);await c.load();await c.route('p_gma','school')
 render(<MapView controller={c}/>)
 expect(screen.queryByText(/Sample data/)).not.toBeInTheDocument()
 expect(screen.getByText('Estimated — not live traffic')).toBeVisible()
 expect(screen.getAllByText('Returned Maplewood School').length).toBeGreaterThan(0)
 expect(screen.getByRole('link',{name:/Open this day in Family Calendar/})).toHaveAttribute('href','#/calendar?day=2026-11-03&childId=authorized-child&view=day')
 expect(screen.getByRole('button',{name:/Propose pickup/})).toBeDisabled()
 c.propose();expect(c.getSnapshot().proposal).toBe('none')
})
it('hides the amount, basis and cap when a viewer may see the route but not pickup costs',async()=>{
 const fixture=createMockMapAdapter('kendra'),world=await fixture.readWorld(),result=await fixture.route('p_gma','school','Drive')
 const c=new MapController({mode:'mock',readWorld:async()=>({...world,canReadCost:false,canApprove:false}),route:async()=>result})
 await c.load();await c.route('p_gma','school');render(<MapView controller={c}/>)
 expect(screen.getByRole('region',{name:'Route estimate'})).toBeVisible()
 expect(screen.queryByText(/Rideshare to school/)).not.toBeInTheDocument()
 expect(screen.queryByText(/road-distance estimate/)).not.toBeInTheDocument()
 expect(screen.queryByText(/Over Kendra's/)).not.toBeInTheDocument()
})
it('labels a stored haversine-basis amount as a straight-line approximation',async()=>{
 const fixture=createMockMapAdapter('kendra'),world=await fixture.readWorld(),result=await fixture.route('p_gma','school','Drive')
 const basis='FridgeGraph synthetic planning estimate: haversine distance × $1.40/mi'
 const c=new MapController({mode:'mock',readWorld:async()=>world,route:async()=>({...result,rideEstimate:{...sampleRide,basis}})})
 await c.load();await c.route('p_gma','school');render(<MapView controller={c}/>)
 expect(screen.getByText('Straight-line approximation — may understate road cost')).toBeVisible()
 expect(screen.getByText(basis)).toBeVisible()
 expect(screen.getByText(/Rideshare to school · Est. \$12.40/)).toBeVisible()
})
it('shows missing person locations and event place states without inventing pins or participants',async()=>{
 const fixture=createMockMapAdapter('kendra'),sample=await fixture.readWorld()
 const world={...sample,state:'live' as const,people:[{id:'p_recorded',name:'Person from graph',position:{source:'unavailable' as const,label:'No location provided for this person in this map',addressRead:false},vehicle:'unknown' as const}],places:[{id:'rp_withheld',name:'Place label from graph',kind:'park' as const,addressRead:false}],events:[{id:'e_withheld',day:'2026-11-03',at:'2026-11-03T17:00:00Z',end:'2026-11-03T18:00:00Z',title:'Event from graph',placeId:null,placeState:'WITHHELD' as const,peopleIds:[],status:'CONFIRMED'}],days:['2026-11-03'],canReadCost:false,canApprove:false}
 const controller=new MapController({mode:'live',readWorld:async()=>world,route:async()=>{throw Error('LOCATION_NOT_RECORDED')}})
 await controller.load();render(<MapView controller={controller}/>)
 expect(screen.getByText('Place details not shared with you')).toBeVisible()
 expect(screen.queryByText('Place not recorded')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:/People/}))
 expect(screen.getByText('No location provided for this person in this map')).toBeVisible()
 expect(screen.getByRole('option',{name:/Person from graph.*location not provided/})).toBeDisabled()
 expect(screen.getByRole('button',{name:'Estimate route'})).toBeDisabled()
})
it('shows only a parent or guardian the separately recorded pickup estimate, with basis and cap',async()=>{
 const fixture=createMockMapAdapter('kendra'),sample=await fixture.readWorld()
 const storedRideEstimates=[{jobId:'job-recorded',candidateId:'p_gma',candidateName:'Loretta from graph',amountUsd:12.4,capUsd:10,distanceMiles:8.86,basis:'haversine',paidRidePath:true as const}]
 const world={...sample,state:'live' as const,canReadCost:true,storedRideEstimates,rideReadState:'ready' as const}
 const parent=new MapController({mode:'live',readWorld:async()=>world,route:fixture.route});await parent.load();render(<MapView controller={parent}/>)
 expect(screen.getByRole('region',{name:'Recorded pickup ride estimates'})).toHaveTextContent('Loretta from graph · Rideshare option · Est. $12.40')
 expect(screen.getByText('Straight-line approximation — may understate road cost')).toBeVisible()
 expect(screen.getByText(/Over the household's \$10\.00 ride limit/)).toBeVisible()
 cleanup()
 const limited=new MapController({mode:'live',readWorld:async()=>({...world,canReadCost:false,storedRideEstimates:[]}),route:fixture.route});await limited.load();render(<MapView controller={limited}/>)
 expect(screen.queryByRole('region',{name:'Recorded pickup ride estimates'})).not.toBeInTheDocument()
 expect(screen.queryByText(/\$12\.40/)).not.toBeInTheDocument()
})
