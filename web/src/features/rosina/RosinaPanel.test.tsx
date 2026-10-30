import { fireEvent, render, screen, waitFor, within, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMemo } from 'react'
import App from '@/App'
import { createMockAuthAdapter } from '@/features/personas/auth'
import { SessionProvider, useSession } from '@/features/personas/Session'
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
