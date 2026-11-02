import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {ApolloClient,ApolloLink,InMemoryCache,Observable,type FetchResult} from '@apollo/client'
import {expect,it,vi} from 'vitest'
import {SignatureVillage} from './AuthorizedVillage'
function response(id:string){return {data:{child:{person:{id,displayName:'Child '+id}},householdMembers:[],relationships:[{id:'relationship-'+id,from:{id:'person-'+id,displayName:'Person '+id},to:{id},type:'parent',status:'ACTIVE'}]}}}
it('only shows authorized choices and drops a late old-child result while preserving current focus',async()=>{
 const pending=new Map<string,(result:FetchResult)=>void>(),read=vi.fn(fn=>fn()),choose=vi.fn(),client=new ApolloClient({cache:new InMemoryCache(),link:new ApolloLink(op=>new Observable<FetchResult>(observer=>{pending.set(op.variables.childId,result=>{observer.next(result);observer.complete()})}))})
 const props={client,childChoices:[{id:'a',name:'Child a'},{id:'b',name:'Child b'}],childListState:'ready' as const,onSelectChild:choose,runRead:read}
 const view=render(<SignatureVillage {...props} child={{id:'a',name:'Child a'}}/>);await waitFor(()=>expect(pending.has('a')).toBe(true));fireEvent.change(screen.getByLabelText('Viewing'),{target:{value:'b'}});expect(choose).toHaveBeenCalledWith('b');view.rerender(<SignatureVillage {...props} child={{id:'b',name:'Child b'}}/>);await waitFor(()=>expect(pending.has('b')).toBe(true));await act(async()=>{pending.get('b')!(response('b'))});await screen.findByRole('button',{name:'Person b parent'});await act(async()=>{pending.get('a')!(response('a'))});expect(screen.queryByRole('button',{name:'Person a parent'})).not.toBeInTheDocument();expect(screen.queryByRole('option',{name:'Foreign child'})).not.toBeInTheDocument();client.stop()
})
it('refusal and upstream failure remain distinct from an authorized empty child list',()=>{
 const base={client:null,child:null,childChoices:[],onSelectChild:vi.fn(),runRead:<T,>(fn:()=>Promise<T>)=>fn()}
 const view=render(<SignatureVillage {...base} childListState="empty"/>);expect(screen.getByText('No records are available to this view.')).toBeInTheDocument();view.rerender(<SignatureVillage {...base} childListState="refused"/>);expect(screen.getByText("This isn't shared with you")).toBeInTheDocument();view.rerender(<SignatureVillage {...base} childListState="error"/>);expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this just now")
})
it('shows the approved Dad sample only for an authorized selected person, never as a live status',async()=>{
 const client=new ApolloClient({cache:new InMemoryCache(),link:new ApolloLink(()=>new Observable<FetchResult>(observer=>{
  observer.next({data:{child:{person:{id:'p_nora',displayName:'Nora'}},householdMembers:[],relationships:[
   {id:'dad',from:{id:'p_dad',displayName:'Andre'},to:{id:'p_nora'},type:'parent',status:'ACTIVE'},
   {id:'other',from:{id:'p_other',displayName:'Another person'},to:{id:'p_nora'},type:'caregiver',status:'ACTIVE'},
  ]}});observer.complete()
 }))})
 render(<SignatureVillage client={client} child={{id:'p_nora',name:'Nora'}} childChoices={[{id:'p_nora',name:'Nora'}]} childListState="ready" onSelectChild={vi.fn()} runRead={fn=>fn()}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Andre parent'}));
 expect(screen.getByRole('complementary',{name:'Selected person details'})).toHaveTextContent('Changing a diaper');
 expect(screen.getByRole('status',{name:/Sample shared status/})).toHaveTextContent('ETA: unknown');
 fireEvent.click(screen.getByRole('button',{name:'Another person caregiver'}));
 expect(screen.queryByRole('status',{name:/Sample shared status/})).not.toBeInTheDocument();
 client.stop()
})
