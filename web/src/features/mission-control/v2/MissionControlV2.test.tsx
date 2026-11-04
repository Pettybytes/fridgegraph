import {act,fireEvent,render,screen,within,waitFor} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import App from '@/App'
import {SessionProvider,useSession} from '@/features/personas/Session'
import {createMockAuthAdapter} from '@/features/personas/auth'
import {RideEstimate,ContactBadge,MissionControlV2} from './MissionControlV2'
async function enter(name='Kendra'){
 window.location.hash='#/mission-control';render(<App/>);fireEvent.click(screen.getByRole('button',{name:new RegExp(name)}));await screen.findByText('Signed in as '+name)
 const link=screen.getByRole('link',{name:'Mission Control'});fireEvent.click(link);fireEvent(window,new HashChangeEvent('hashchange'))
 if(name==='Priya')await screen.findByRole('alert')
 else await screen.findByRole('region',{name:'Mission Control recorded pickup'})
}
function finish(){for(let i=0;i<5;i++)fireEvent.click(screen.getByRole('button',{name:/Next recorded step/}))}
it('replays a complete normal job with independent lanes and an unskippable app confirm',async()=>{
 await enter()
 expect(within(screen.getByRole('region',{name:'Mission Control recorded pickup',hidden:true})).getByRole('status',{hidden:true})).toHaveTextContent('Pickup request received')
 expect(screen.queryByRole('button',{name:'Approve pickup'})).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:/Next recorded step/}))
 expect(screen.getAllByText('Waiting for reply')).toHaveLength(4)
 expect(screen.getAllByText('Test responder')).toHaveLength(4)
 finish()
 expect(screen.getByRole('article',{name:'Monique Davis outreach lane'})).toHaveTextContent('No answer')
 expect(screen.getByRole('article',{name:'Monique Davis outreach lane'})).toHaveTextContent('System observation')
 expect(screen.getByRole('article',{name:'Bryan Brooks outreach lane'})).toHaveTextContent('Declined')
 expect(screen.queryByText('Estimated travel cost')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Approve pickup'}))
 expect(within(screen.getByRole('region',{name:'Mission Control recorded pickup',hidden:true})).getByRole('status',{hidden:true})).toHaveTextContent('Waiting for Kendra')
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm demo approval'}))
 expect(within(screen.getByRole('region',{name:'Mission Control recorded pickup',hidden:true})).getByRole('status',{hidden:true})).toHaveTextContent('Parent approval recorded')
 expect(screen.getByText('Kendra approved Tasha at 11:14 AM.')).toBeVisible()
 expect(screen.getByText(/Pickup completion has not been recorded/)).toBeVisible()
})
it('requires explicit over-limit acceptance in the distinct no-driver night without fabricating timestamps',async()=>{
 await enter();finish();fireEvent.click(screen.getByRole('button',{name:'No-driver night'}))
 expect(screen.queryByText('Tasha Ellison')).not.toBeInTheDocument()
 expect(screen.getByText('Current state · time not recorded')).toBeVisible()
 expect(screen.getByRole('button',{name:'Review rideshare option'})).toBeEnabled()
 fireEvent.click(screen.getByRole('button',{name:'Review rideshare option'}))
 const dialog=screen.getByRole('dialog')
 const accept=within(dialog).getByRole('button',{name:'Accept over-limit option'})
 expect(accept).toBeDisabled();fireEvent.click(accept)
 expect(within(screen.getByRole('region',{name:'Mission Control recorded pickup',hidden:true})).getByRole('status',{hidden:true})).toHaveTextContent('No driver can do this pickup')
 fireEvent.click(within(dialog).getByRole('checkbox',{name:'I accept this option above my travel limit'}));fireEvent.click(accept)
 expect(within(screen.getByRole('region',{name:'Mission Control recorded pickup',hidden:true})).getByRole('status',{hidden:true})).toHaveTextContent('Parent approval recorded')
 expect(screen.getByText(/Confirmation time not recorded/)).toBeVisible()
 expect(document.querySelector('.mcv-timeline time')).toBeNull()
})
it('makes no-car estimates nullable while preserving zero and the basis',()=>{
 const {rerender}=render(<RideEstimate value={null}/>);expect(screen.queryByText('Estimated travel cost')).not.toBeInTheDocument()
 rerender(<RideEstimate value={0} basis="Recorded mock basis"/>);expect(screen.getByText(/Est. \$0.00/)).toBeVisible();expect(screen.getByText('Recorded basis: Recorded mock basis')).toBeVisible()
 rerender(<RideEstimate value={0} basis="FridgeGraph synthetic planning estimate: haversine distance × $1.40/mi"/>);expect(screen.getByText('Straight-line approximation, may understate road cost')).toBeVisible()
})
it('does not show the paid-ride amount, basis or household cap to the Demo guide',async()=>{
 const mock=createMockAuthAdapter()
 const adapter={...mock,signInAsPersona:async(id:Parameters<typeof mock.signInAsPersona>[0])=>({...await mock.signInAsPersona(id),marks:{demo:true,demoGuide:id==='demo-guide'}})}
 function GuideView(){const {session,switchPerson}=useSession();return <><button onClick={()=>void switchPerson('demo-guide')}>Choose guide</button>{session&&<MissionControlV2 accessDenied={<p>Access denied</p>}/>}</>}
 render(<SessionProvider adapter={adapter}><GuideView/></SessionProvider>)
 fireEvent.click(screen.getByRole('button',{name:'Choose guide'}))
 await screen.findByRole('button',{name:/Next recorded step/})
 finish();fireEvent.click(screen.getByRole('button',{name:'No-driver night'}))
 expect(screen.getByText('Only a parent or guardian can view paid-ride amounts and limits.')).toBeVisible()
 expect(screen.queryByText('Estimated travel cost')).not.toBeInTheDocument()
 expect(screen.queryByText(/recorded \$10 paid-ride limit/)).not.toBeInTheDocument()
 expect(screen.queryByText(/Recorded basis:/)).not.toBeInTheDocument()
})
it('renders real-consented, test-responder and simulated badges with different modes',()=>{
 render(<><ContactBadge mode="REAL_CONSENTED"/><ContactBadge mode="TEST_RESPONDER"/><ContactBadge mode="SIMULATED"/></>)
 expect(screen.getByText('Real call (consented)')).toHaveClass('mcv-mode-real_consented')
 expect(screen.getByText('Test responder')).toHaveClass('mcv-mode-test_responder')
 expect(screen.getByText('Simulated')).toHaveClass('mcv-mode-simulated')
})
it('keeps Andre read-only for the job with Kendra as the recorded approver',async()=>{
 await enter('Andre');finish();expect(screen.getByRole('button',{name:'Approve pickup'})).toBeDisabled();expect(screen.getByText(/Only Kendra can approve/)).toBeVisible()
})
it('shows the role-aware scope boundary for Priya',async()=>{
 await enter('Priya');expect(screen.getByRole('alert')).toHaveTextContent("You can see Nora's schedule and care information.")
 expect(screen.queryByRole('region',{name:'Mission Control recorded pickup'})).not.toBeInTheDocument()
})
it('cleans up a pending replay and private lanes before another persona loads',async()=>{
 await enter();fireEvent.click(screen.getByRole('button',{name:/Play recorded steps/}));fireEvent.click(screen.getByRole('button',{name:'Switch person'}))
 expect(screen.queryByRole('region',{name:'Mission Control recorded pickup'})).not.toBeInTheDocument()
 await waitFor(()=>expect(screen.getByRole('button',{name:/Priya/})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:/Priya/}))
 await screen.findByText('Signed in as Priya');expect(screen.queryByText('Tasha Ellison')).not.toBeInTheDocument()
})
it('auto replay stops at the recommendation and never automatically records approval',async()=>{
 await enter();vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:/Play recorded steps/}))
 for(let i=0;i<5;i++)await act(async()=>{vi.advanceTimersByTime(1500)})
 expect(within(screen.getByRole('region',{name:'Mission Control recorded pickup',hidden:true})).getByRole('status',{hidden:true})).toHaveTextContent('Waiting for Kendra')
 await act(async()=>{vi.advanceTimersByTime(30000)})
 expect(within(screen.getByRole('region',{name:'Mission Control recorded pickup',hidden:true})).getByRole('status',{hidden:true})).toHaveTextContent('Waiting for Kendra');vi.useRealTimers()
})
