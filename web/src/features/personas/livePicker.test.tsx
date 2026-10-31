import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import App from '@/App'
import {createLiveAuthAdapter} from './liveAuth'
import {readyBody} from './sessionTestFixtures'
import {dataErrorMessage} from '@/lib/frontendData/provider'
import {actionAllowed} from '@/features/rosina/catalog'
it('uses the public live picker by default, without minting any READY identity before a click',async()=>{
 vi.stubEnv('VITE_DEV_MOCK_AUTH','false')
 const request=vi.fn<typeof fetch>(async(url)=>String(url).endsWith('health')?Response.json({personas:[{personaId:'rosa',ready:false},{personaId:'kendra',ready:true}]}):Response.json({status:'UNAVAILABLE',personaId:'rosa',reason:'NO_SEEDED_IDENTITY'}))
 vi.stubGlobal('fetch',request);render(<App/>);expect(screen.getByRole('heading',{level:1})).toHaveTextContent('Explore FridgeGraph as')
 await waitFor(()=>expect(screen.getByRole('button',{name:'Explore as Rosa Castellano'})).toBeDisabled())
 expect(screen.getByRole('button',{name:'Explore as Kendra'})).toBeEnabled();expect(screen.getByText('Not set up in this demo yet')).toBeVisible()
 expect(request.mock.calls.filter(c=>String(c[0]).endsWith('login')).every(c=>JSON.parse(String(c[1]?.body)).personaId==='rosa')).toBe(true)
 vi.unstubAllGlobals();vi.unstubAllEnvs()
})
it('temporary failures leave the persona selectable without a false Coming soon state',async()=>{
 const request=vi.fn<typeof fetch>(async url=>String(url).endsWith('health')?Response.json({personas:[]}):Response.json({status:'UNAVAILABLE',reason:'MINT_LINK_FAILED'},{status:503}))
 render(<App authAdapter={createLiveAuthAdapter(request)}/>);fireEvent.click(screen.getByRole('button',{name:'Explore as Kendra'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('Busy, try again in a moment');expect(screen.getByRole('button',{name:'Explore as Kendra'})).toBeEnabled();expect(screen.queryByText('Coming soon')).not.toBeInTheDocument()
})
it('guide marks prevent data-changing catalog cards even if a persona claims parent status',()=>{
 const context={childId:'p_nora',parent:true,readOnly:true,visiblePeople:new Set<string>()}
 expect(actionAllowed({id:'start-pickup',args:{childId:'p_nora',date:'2026-10-30',window:'afternoon'}},context)).toBe(false)
 expect(dataErrorMessage({message:'DEMO_GUIDE_READ_ONLY'})).toBe('Demo guide is read-only')
 expect(dataErrorMessage({message:'DEMO_OUTREACH_REFUSED'})).toBe('Calls and texts stay in the demo sandbox.')
 expect(readyBody('demo-guide').marks.demoGuide).toBe(true)
})
it('renews once after a Rosina 401 but never replays the message or asks visitors to sign in',async()=>{
 let logins=0,messages=0
 const request=vi.fn<typeof fetch>(async(url)=>{
  if(String(url).endsWith('health'))return Response.json({personas:[]})
  if(String(url).endsWith('/login')){logins++;return Response.json(readyBody())}
  if(String(url).endsWith('/rosina')){messages++;return new Response('',{status:401})}
  return Response.json({errors:[{message:'UNAUTHORIZED',extensions:{code:'UNAUTHORIZED'}}]})
 })
 vi.stubGlobal('fetch',request);window.location.hash='#/ask-rosina'
 render(<App authAdapter={createLiveAuthAdapter(request)}/>);fireEvent.click(screen.getByRole('button',{name:'Explore as Kendra'}));await screen.findByText('Exploring as Kendra')
 fireEvent.change(screen.getByLabelText('Message Rosina'),{target:{value:'Who can help?'}});fireEvent.submit(screen.getByLabelText('Message Rosina').closest('form')!)
 await screen.findByText('Your perspective is ready again. Please send your question again.')
 expect(logins).toBe(2);expect(messages).toBe(1);expect(screen.queryByText('Please sign in again')).not.toBeInTheDocument();vi.unstubAllGlobals()
})
