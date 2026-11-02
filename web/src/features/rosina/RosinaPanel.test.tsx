import { fireEvent, render, screen, waitFor, within, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMemo } from 'react'
import type { ApolloClient } from '@apollo/client'
import App from '@/App'
import { createMockAuthAdapter } from '@/features/personas/auth'
import { SessionProvider, useSession } from '@/features/personas/Session'
import { ChildAccessProvider, useChildAccess } from '@/features/personas/childContext'
import { createPersonaDataAdapter } from '@/features/personas/personaData'
import { RosinaPanel } from './RosinaPanel'
import type { RosinaAdapter, RosinaResponse } from './adapter'
async function send(message: string) {
  fireEvent.change(screen.getByLabelText('Message Rosina'), { target: { value: message } })
  fireEvent.submit(screen.getByLabelText('Message Rosina').closest('form')!)
  await waitFor(() => expect(screen.queryByText('Rosina is preparing a reply…')).not.toBeInTheDocument())
}
async function enter(person = 'Kendra') {
  window.location.hash = ''
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(person) }))
  await screen.findByText(`Signed in as ${person}`)
}
function TestPanel({ service }: { service: RosinaAdapter }) {
  const { session, switchPerson } = useSession()
  const data = useMemo(() => session ? createPersonaDataAdapter(session) : undefined, [session])
  return <><button onClick={() => { void switchPerson('kendra') }}>Pick Kendra</button><button onClick={() => { void switchPerson('loretta') }}>Pick Loretta</button><p>{session?.persona.name}</p><RosinaPanel key={session?.generation ?? 0} service={service} dataAdapter={data} /></>
}
function harness(service: RosinaAdapter) { render(<SessionProvider adapter={createMockAuthAdapter()}><TestPanel service={service} /></SessionProvider>) }
describe('scripted Rosina acceptance examples', () => {
  it.each([
    ['What can I do here?', /You can review pickup plans/],
    ["Show me Nora's afternoon.", /afternoon pickup: waiting for parent approval/],
    ['Why was this caregiver recommended?', /Tasha Ellison is the recorded choice for this pickup/],
    ["I'm new to this village.", /Start with your own village/],
    ["Show me another family's child.", /can't show another family's child/],
  ])('%s', async (prompt, expected) => {
    await enter()
    await send(prompt)
    expect(screen.getByText(expected)).toBeVisible()
    if (/another family/.test(prompt)) expect(screen.getByRole('log')).not.toHaveTextContent('Jax Coleman')
  })
  it('gathers pickup details then requires an app confirm card', async () => {
    await enter()
    await send('Arrange a pickup.')
    expect(screen.getByText(/Which date/)).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await send('2026-10-30 afternoon')
    fireEvent.click(screen.getByRole('button', { name: /Review pickup request/ }))
    const dialog = screen.getByRole('dialog', { name: 'Confirm pickup request' })
    expect(within(dialog).getByText('Nora Ellison')).toBeVisible()
    expect(screen.queryByText(/No pickup was arranged/)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm demo pickup request' }))
    expect(await screen.findByText(/Your demo request has been reviewed. No pickup was arranged/)).toBeVisible()
  })
  it('answers Priya from recorded care information with its source', async () => {
    await enter('Priya')
    await send('Can Nora have a peanut-butter snack?')
    expect(screen.getByRole('log')).toHaveTextContent('Peanut allergy. Epi-pen in right backpack pocket.')
    expect(screen.getByRole('log')).toHaveTextContent("No, Nora has a peanut allergy. Her care plan says:")
    expect(screen.getByRole('log')).toHaveTextContent("Source: Nora's care plan.")
    expect(screen.getByRole('log')).not.toHaveTextContent(/src\/|fixture|added by Kendra/)
    expect(screen.getByRole('log')).not.toHaveTextContent('Tasha Ellison')
  })
})
describe('Rosina safety and session boundaries', () => {
  it('does not render unknown/bad actions or interpret HTML and links', async () => {
    harness({ mode: 'mock', send: async () => ({ reply: '<a href="https://outside.example">Do this</a><img src=x>', actions: [{ id: 'unknown', args: {} }, { id: 'open-screen', args: { screen: 'https://outside.example' } }] }) })
    await send('Hello')
    const log = screen.getByRole('log')
    expect(log).toHaveTextContent('<a href="https://outside.example">Do this</a><img src=x>')
    expect(log.querySelector('a, img')).toBeNull()
    expect(within(log).queryByRole('button')).not.toBeInTheDocument()
  })
  it('ignores a response claiming no confirm and Cancel never performs an action', async () => {
    harness({ mode: 'mock', send: async () => ({ reply: 'Skip confirmation', actions: [{ id: 'start-pickup', args: { childId: 'p_nora', date: '2026-10-30', window: 'afternoon' }, requiresConfirmation: false }] }) })
    fireEvent.click(screen.getByRole('button', { name: 'Pick Kendra' }))
    await screen.findByText('Kendra', { selector: 'p' })
    await send('Arrange it')
    fireEvent.click(screen.getByRole('button', { name: /Review pickup request/ }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.queryByText(/No pickup was arranged/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText(/No pickup was arranged/)).not.toBeInTheDocument()
  })
  it('sends only this persona history and discards a late reply after switching', async () => {
    let resolveLate!: (response: RosinaResponse) => void
    const sendSpy = vi.fn<RosinaAdapter['send']>().mockResolvedValueOnce({ reply: 'First private reply', actions: [] }).mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve })).mockResolvedValue({ reply: 'New persona reply', actions: [] })
    harness({ mode: 'mock', send: sendSpy })
    fireEvent.click(screen.getByRole('button', { name: 'Pick Kendra' }))
    await screen.findByText('Kendra', { selector: 'p' })
    await send('First private question')
    fireEvent.change(screen.getByLabelText('Message Rosina'), { target: { value: 'Second private question' } })
    fireEvent.submit(screen.getByLabelText('Message Rosina').closest('form')!)
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(2))
    expect(sendSpy.mock.calls[1][0].history).toEqual([{ role: 'user', content: 'First private question' }, { role: 'assistant', content: 'First private reply' }])
    fireEvent.click(screen.getByRole('button', { name: 'Pick Loretta' }))
    expect(screen.queryByText('First private reply')).not.toBeInTheDocument()
    await screen.findByText('Loretta', { selector: 'p' })
    await act(async () => resolveLate({ reply: 'Late Kendra secret', actions: [] }))
    expect(screen.queryByText('Late Kendra secret')).not.toBeInTheDocument()
    await send('New question')
    expect(sendSpy.mock.calls[2][0].history).toEqual([])
  })
})

describe('school-day report review', () => {
  it('offers a clearly sample review to Ms. Whitfield and never files on render', async () => {
    await enter('Ms. Whitfield')
    await send('Nora has a fever today. Prepare a school-day report.')
    const card = screen.getByRole('region', { name: 'Review proposed school-day report' })
    expect(card).toHaveTextContent('Sample proposal · No school record will be filed')
    expect(card).toHaveTextContent('Nora has a fever today.')
    expect(screen.getByRole('log')).toHaveTextContent('Nothing has been filed.')
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm report' }))
    expect(await within(card).findByText(/Sample reviewed. No school record was filed/)).toBeVisible()
  })
  it('never exposes the proposal body or confirm button to a persona without school.report', async () => {
    harness({ mode: 'mock', send: async () => ({ reply: 'A proposal is ready.', actions: [], schoolReportProposal: { id: 'srp_private', version: 1, childId: 'p_nora', kind: 'fever', text: 'Private school detail', createdAt: '2026-11-01T20:00:00Z', expiresAt: '2099-11-01T20:10:00Z' } }) })
    fireEvent.click(screen.getByRole('button', { name: 'Pick Kendra' }))
    await screen.findByText('Kendra', { selector: 'p' })
    await send('Tell me about the report')
    expect(screen.getByRole('log')).toHaveTextContent('This report proposal is not shared with your role.')
    expect(screen.getByRole('log')).not.toHaveTextContent('Private school detail')
    expect(screen.queryByRole('button', { name: 'Confirm report' })).not.toBeInTheDocument()
  })
  it('clears the proposal when the selected child changes, even inside the same persona', async () => {
    const client = {query:vi.fn().mockResolvedValue({data:{myChildren:[
      {child:{id:'p_nora',person:{displayName:'Nora Ellison'}},scopes:['school.report']},
      {child:{id:'p_jax',person:{displayName:'Jax Coleman'}},scopes:[]},
    ]}})} as unknown as ApolloClient
    const directRead = <T,>(read:()=>Promise<T>) => read()
    const proposal={id:'srp_private',version:1,childId:'p_nora',kind:'fever',text:'Private teacher report',createdAt:'2026-11-01T20:00:00Z',expiresAt:'2099-11-01T20:10:00Z'}
    const service:RosinaAdapter={mode:'mock',send:async()=>({reply:'Please review this sample.',actions:[],schoolReportProposal:proposal})}
    function FocusedPanel(){const {session,switchPerson}=useSession();return session?<ChildAccessProvider client={client} selectedChildId={session.scope.childId} selectedChildName={session.scope.childName} runRead={directRead} generation={session.generation}><FocusSwitch/><RosinaPanel service={service}/></ChildAccessProvider>:<button onClick={()=>{void switchPerson('whitfield')}}>Pick teacher</button>}
    function FocusSwitch(){const access=useChildAccess();return <button onClick={()=>access?.selectChild('p_jax')}>Focus Jax</button>}
    render(<SessionProvider adapter={createMockAuthAdapter()}><FocusedPanel/></SessionProvider>)
    fireEvent.click(screen.getByRole('button',{name:'Pick teacher'}))
    await screen.findByRole('button',{name:'Focus Jax'})
    await waitFor(()=>expect(client.query).toHaveBeenCalled())
    await send('Nora has a fever today')
    expect(screen.getByRole('region',{name:'Review proposed school-day report'})).toHaveTextContent('Private teacher report')
    fireEvent.click(screen.getByRole('button',{name:'Focus Jax'}))
    await waitFor(()=>expect(screen.queryByText('Private teacher report')).not.toBeInTheDocument())
    expect(screen.queryByRole('button',{name:'Confirm report'})).not.toBeInTheDocument()
  })
})

describe('Add a Villager review mount', () => {
  const proposal = {id:'vp_1',version:1,childId:'p_nora',personId:'p_dana',personDisplayName:'Dana Coleman',relationshipType:'friend_parent',scopes:['pickup.request'],validFrom:null,validUntil:null,createdAt:'2026-11-01T20:00:00Z',expiresAt:'2099-11-01T20:10:00Z'}
  function Panel({service}:{service:RosinaAdapter}) {
    const {session,switchPerson}=useSession()
    return <><button onClick={()=>void switchPerson('kendra')}>Choose Kendra</button><button onClick={()=>void switchPerson('priya')}>Choose Priya</button>
      {session&&<ChildAccessProvider key={session.generation} client={null} selectedChildId={session.scope.childId} selectedChildName={session.scope.childName} runRead={read=>read()} generation={session.generation}><RosinaPanel service={service}/></ChildAccessProvider>}</>
  }
  function mount(service:RosinaAdapter){render(<SessionProvider adapter={createMockAuthAdapter()}><Panel service={service}/></SessionProvider>)}
  it('mounts the structured review in mock mode and confirms only after the parent clicks',async()=>{
    mount({mode:'mock',send:async()=>({reply:'Review the recorded proposal below.',actions:[],addVillagerProposal:proposal})})
    fireEvent.click(screen.getByRole('button',{name:'Choose Kendra'}))
    await screen.findByLabelText('Message Rosina')
    await send('Add Dana to Nora’s village')
    const card=screen.getByRole('region',{name:'Review Add a Villager proposal'})
    expect(card).toHaveAttribute('data-mode','mock')
    expect(card).toHaveTextContent('Dana Coleman')
    expect(card).toHaveTextContent('pickup.request')
    expect(card).toHaveTextContent('Sample review only. Confirm creates no relationship or permission.')
    expect(card).not.toHaveTextContent('Sample reviewed')
    fireEvent.click(within(card).getByRole('button',{name:'Confirm Add a Villager'}))
    expect(await within(card).findByText('Sample reviewed. No relationship or permission was created.')).toBeVisible()
  })
  it('drops malformed proposals and never builds a card from Rosina prose',async()=>{
    mount({mode:'mock',send:async()=>({reply:'Dana Coleman is in a proposal.',actions:[],addVillagerProposal:{...proposal,scopes:['address.read']} as never})})
    fireEvent.click(screen.getByRole('button',{name:'Choose Kendra'}))
    await screen.findByLabelText('Message Rosina')
    await send('Show proposal')
    expect(screen.getByRole('log')).toHaveTextContent('Dana Coleman is in a proposal.')
    expect(screen.queryByRole('region',{name:'Review Add a Villager proposal'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Confirm Add a Villager'})).not.toBeInTheDocument()
  })
  it('hides proposal details from Priya and clears the thread on perspective switch',async()=>{
    mount({mode:'mock',send:async()=>({reply:'A proposal was prepared.',actions:[],addVillagerProposal:proposal})})
    fireEvent.click(screen.getByRole('button',{name:'Choose Priya'}))
    await screen.findByLabelText('Message Rosina')
    await send('Show proposal')
    expect(screen.getByRole('region',{name:'Add a Villager unavailable'})).toBeVisible()
    expect(screen.getByRole('log')).not.toHaveTextContent('Dana Coleman')
    expect(screen.queryByRole('button',{name:'Confirm Add a Villager'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Choose Kendra'}))
    await screen.findByLabelText('Message Rosina')
    await send('Show proposal')
    expect(screen.getByRole('region',{name:'Review Add a Villager proposal'})).toHaveTextContent('Dana Coleman')
    fireEvent.click(screen.getByRole('button',{name:'Choose Priya'}))
    await waitFor(()=>expect(screen.queryByRole('region',{name:'Review Add a Villager proposal'})).not.toBeInTheDocument())
    expect(screen.getByRole('log')).not.toHaveTextContent('Dana Coleman')
  })
})
