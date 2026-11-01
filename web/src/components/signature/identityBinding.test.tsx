import {fireEvent,render,screen} from '@testing-library/react'
import {ApolloClient,ApolloLink,InMemoryCache,Observable} from '@apollo/client'
import {expect,it} from 'vitest'
import {portraitFor} from '@/components/fg/portraits'
import {ChildAccessProvider,useChildAccess} from '@/features/personas/childContext'
it('an unknown person id never borrows a verified portrait through a matching full name',()=>{expect(portraitFor({personId:'new-fictional-child',name:'Nora Ellison'})).toBeUndefined();expect(portraitFor({personId:'p_nora'})).toBeDefined()})
it('a selected child whose name was not shared never borrows the home child name',async()=>{
 const client=new ApolloClient({cache:new InMemoryCache(),link:new ApolloLink(()=>new Observable(observer=>{observer.next({data:{myChildren:[{child:{id:'home',person:{displayName:'Home child'}},scopes:['schedule.read']},{child:{id:'other',person:{displayName:null}},scopes:['schedule.read']}]}});observer.complete()}))})
 function Probe(){const access=useChildAccess();return <><p>{access?.authorized.status}</p><p data-testid="focused-name">{access?.selectedChildName}</p><button onClick={()=>access?.selectChild('other')}>Focus other child</button></>}
 const runRead=<T,>(read:()=>Promise<T>)=>read()
 render(<ChildAccessProvider client={client} selectedChildId="home" selectedChildName="Home child" runRead={runRead} generation={1}><Probe/></ChildAccessProvider>);await screen.findByText('ready');fireEvent.click(screen.getByRole('button',{name:'Focus other child'}));expect(screen.getByTestId('focused-name')).toHaveTextContent('Name not shared');client.stop()
})
