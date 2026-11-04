import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import {SessionProvider,useSession} from '@/features/personas/Session'
import {createMockAuthAdapter} from '@/features/personas/auth'
import {RosinaPanel} from './RosinaPanel'
const fixture=vi.hoisted(()=>({mutate:vi.fn(),lastVoiceReply:undefined as unknown}))
vi.mock('@/features/personas/childContext',()=>({useChildAccess:()=>({selectedChildId:'p_nora',selectedChildName:'Nora Ellison',client:{mutate:fixture.mutate},authorized:{status:'ready',children:[]}})}))
vi.mock('@/features/voice/RosinaVoiceButton',()=>({RosinaVoiceButton:({onTranscript,onReply}:{onTranscript:(t:string)=>void;onReply:(r:string,a:unknown[])=>unknown})=><button onClick={()=>{onTranscript('yes');fixture.lastVoiceReply=onReply('Unverified model acknowledgment',[])}}>Spoken yes fixture</button>}))
vi.mock('@/lib/frontendData/resourceCache',()=>({invalidateResources:vi.fn()}))
const args={operation:'create',childId:'p_nora',childName:'Nora Ellison',eventId:'',title:'Birthday party',start:'2026-11-05T21:00:00',end:'2026-11-05T22:00:00',location:'Home',notes:'',color:'',status:'confirmed'}
const send=vi.fn(async()=>({reply:'Review this event',actions:[{id:'calendar-change',args}]}))
function Panel(){const{switchPerson}=useSession();return <><button onClick={()=>void switchPerson('kendra')}>Choose Kendra</button><RosinaPanel service={{mode:'live',send}}/></>}
it('spoken yes uses the current confirmation, suppresses model acknowledgment and waits for the saved API response',async()=>{
 let save!:(value:unknown)=>void
 fixture.mutate.mockImplementation(()=>new Promise(resolve=>{save=resolve}))
 window.location.hash='#/ask-rosina'
 render(<SessionProvider adapter={createMockAuthAdapter()}><Panel/></SessionProvider>)
 fireEvent.click(screen.getByRole('button',{name:'Choose Kendra'}))
 await waitFor(()=>expect(screen.getByText('Live')).toBeVisible())
 fireEvent.change(screen.getByLabelText('Message Rosina'),{target:{value:'Book a birthday party for Nora tomorrow at 9pm'}})
 fireEvent.submit(screen.getByLabelText('Message Rosina').closest('form')!)
 await screen.findByRole('button',{name:'Add to calendar'})
 expect(fixture.mutate).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Spoken yes fixture'}))
 fireEvent.click(screen.getByRole('button',{name:'Spoken yes fixture'}))
 expect(fixture.mutate).toHaveBeenCalledTimes(1)
 expect(fixture.lastVoiceReply).toBe(false)
 expect(screen.queryByText(/Done:/)).not.toBeInTheDocument()
 expect(screen.queryByText('Unverified model acknowledgment')).not.toBeInTheDocument()
 await act(async()=>{save({data:{createCalendarEvent:{...args,id:'saved-event'}}})})
 expect(await screen.findByText(/Done: added Birthday party for Nora Ellison/)).toBeVisible()
 expect(send).toHaveBeenCalledTimes(1)
 expect(fixture.mutate.mock.calls[0][0].variables.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
})
