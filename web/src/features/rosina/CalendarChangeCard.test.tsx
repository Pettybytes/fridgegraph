import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {it,expect,vi} from 'vitest'
import {ApolloClient,InMemoryCache,ApolloLink} from '@apollo/client'
import {CalendarChangeCard} from './CalendarChangeCard'
import type {CalendarChangeArgs} from './catalog'
const args:CalendarChangeArgs={operation:'create',childId:'p_nora',childName:'Nora Ellison',eventId:'',title:'Birthday party',start:'2026-11-05T21:00:00',end:'2026-11-05T22:00:00',location:'Home',notes:'',color:'',status:'confirmed'}
function setup(mutate:ReturnType<typeof vi.fn>){const client=new ApolloClient({link:ApolloLink.empty(),cache:new InMemoryCache()});client.mutate=mutate as typeof client.mutate;const saved=vi.fn();let confirm:(()=>void)|null=null;const view=render(<CalendarChangeCard args={args} client={client} current register={fn=>{confirm=fn}} onSaved={saved}/>);return {saved,view,confirm:()=>confirm?.()}}
it('requires confirmation and only acknowledges a successful write; double tap sends once',async()=>{
 let resolve!:(value:unknown)=>void;const mutate=vi.fn(()=>new Promise(r=>{resolve=r}));const {saved}=setup(mutate);
 expect(mutate).not.toHaveBeenCalled();expect(screen.getByRole('region')).toHaveTextContent('9:00 PM');
 fireEvent.click(screen.getByRole('button',{name:'Add to calendar'}));fireEvent.click(screen.getByRole('button',{name:'Saving…'}));expect(saved).not.toHaveBeenCalled();expect(mutate).toHaveBeenCalledTimes(1);
 await act(async()=>resolve({data:{createCalendarEvent:{...args,id:'ev-new'}}}));expect(saved).toHaveBeenCalledWith(expect.stringContaining('Done — added Birthday party'));expect(screen.getByRole('status')).toHaveTextContent('Saved');
});
it('text confirmation retries with the same idempotency key after uncertain response',async()=>{
 const mutate=vi.fn().mockRejectedValueOnce(Error('lost response')).mockResolvedValue({data:{createCalendarEvent:{...args,id:'ev-once'}}});const {saved,confirm}=setup(mutate);
 act(()=>confirm());await screen.findByRole('alert');expect(saved).not.toHaveBeenCalled();act(()=>confirm());await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));
 expect(mutate.mock.calls[0][0].variables.idempotencyKey).toBe(mutate.mock.calls[1][0].variables.idempotencyKey);
});
it('late results cannot acknowledge in a different perspective',async()=>{
 let resolve!:(value:unknown)=>void;const mutate=vi.fn(()=>new Promise(r=>{resolve=r}));const {saved,view,confirm}=setup(mutate);act(()=>confirm());view.unmount();await act(async()=>resolve({data:{createCalendarEvent:{...args,id:'ev-new'}}}));expect(saved).not.toHaveBeenCalled();
});
it('retains the proposal key across remounts and never re-enables a saved proposal',async()=>{
 const client=new ApolloClient({link:ApolloLink.empty(),cache:new InMemoryCache()});const mutate=vi.spyOn(client,'mutate').mockRejectedValue(Error('network'));const props={args,client,current:true,requestKey:'4f24bab0-7289-4f6e-aaea-4adc0c714fe0',register:vi.fn(),onSaved:vi.fn()};
 const first=render(<CalendarChangeCard {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Add to calendar'}));await screen.findByRole('alert');first.unmount();
 const second=render(<CalendarChangeCard {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Add to calendar'}));await screen.findByRole('alert');expect(mutate.mock.calls[0][0].variables?.idempotencyKey).toBe(mutate.mock.calls[1][0].variables?.idempotencyKey);
 second.rerender(<CalendarChangeCard {...props} saved/>);expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
