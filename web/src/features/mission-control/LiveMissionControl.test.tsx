import {fireEvent,render,screen} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import {SessionProvider,useSession} from '@/features/personas/Session'
import {createMockAuthAdapter} from '@/features/personas/auth'
import {LiveMissionControl} from './LiveMissionControl'
const surface=vi.hoisted(()=>({runs:[] as unknown[]}))
vi.mock('@/lib/frontendData/provider',()=>({useSurfaceData:()=>({data:{frontendSnapshot:{recordedRuns:surface.runs}},loading:false}),dataErrorMessage:()=> 'Unable to load updates. Try again.'}))
function Choose(){const {switchPerson}=useSession();return <button onClick={()=>{void switchPerson('kendra')}}>Choose Kendra</button>}
async function mount(){render(<SessionProvider adapter={createMockAuthAdapter()}><Choose/><LiveMissionControl accessDenied={<p>Pickup plans are shared with Nora’s parents.</p>}/></SessionProvider>);fireEvent.click(screen.getByRole('button',{name:'Choose Kendra'}));await screen.findByRole('heading',{name:'Nora’s pickup'})}
const job={id:'stored-job',status:'AWAITING_APPROVAL',version:1,candidateEvaluations:[],confirmation:null}
it('shows recorded identity/mode per attempt and preserves missing evaluation and candidate facts',async()=>{
 surface.runs=[{job,attempts:[{id:'a',channel:'CALL',at:'2026-10-30T15:02:00Z',candidate:{id:'caregiver',displayName:'Recorded caregiver'},destinationMode:'TEST_RESPONDER',closedAt:'2026-10-30T15:03:00Z',closedReason:'NO_ANSWER'},{id:'b',channel:'TEXT',at:'2026-10-30T15:02:00Z',candidate:null,destinationMode:'REAL_CONSENTED',closedAt:null}],timeline:[{at:'2026-10-30T15:00:00Z',kind:'JOB_CREATED',candidate:null}]}]
 await mount();expect(screen.getByText('Sample activity')).toBeVisible();expect(screen.queryByText('Recorded run')).not.toBeInTheDocument();expect(screen.getByText(/sending isn’t verified here/)).toBeVisible();expect(screen.getByText('Recorded caregiver')).toBeVisible();expect(screen.getByText('Caregiver not recorded')).toBeVisible();expect(screen.getByText('Test responder')).toBeVisible();expect(screen.getByText('Real call (consented)')).toBeVisible();expect(screen.getByText('No caregiver evaluation has been recorded.')).toBeVisible();expect(screen.queryByText('Declined',{exact:true})).not.toBeInTheDocument();expect(screen.queryByText('Simulated')).not.toBeInTheDocument()
})
it('labels a stored job without persisted events honestly instead of claiming a recorded execution',async()=>{
 surface.runs=[{job,attempts:[],timeline:[]}];await mount();expect(screen.queryByText('Recorded run',{exact:true})).not.toBeInTheDocument();expect(screen.getByText('Event times not recorded.')).toBeVisible()
})
it('keeps an empty job read distinct from refusal while offering role-aware guidance',async()=>{
 surface.runs=[]
 function SharedChoose(){const {switchPerson}=useSession();return <button onClick={()=>{void switchPerson('priya')}}>Choose Priya</button>}
 render(<SessionProvider adapter={createMockAuthAdapter()}><SharedChoose/><LiveMissionControl accessDenied={<p>Pickup plans are shared with Nora’s parents.</p>}/></SessionProvider>)
 fireEvent.click(screen.getByRole('button',{name:'Choose Priya'}))
 expect(await screen.findByText('No records are available to this view')).toBeVisible();expect(screen.getByText('Pickup plans are shared with Nora’s parents.')).toBeVisible()
})
