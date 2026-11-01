import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {MapView} from './VillageMap'
import {MapController} from './controller'
import {createMockMapAdapter,sampleRide} from './mockAdapter'
import {mapCalendar} from './calendar'
vi.mock('./MapCanvas',()=>({MapCanvas:()=> <div>Map canvas</div>}))
vi.mock('motion/react',()=>({useReducedMotion:()=>true}))
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
