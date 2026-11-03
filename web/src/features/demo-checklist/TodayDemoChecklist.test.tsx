import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import App from '@/App'
import { createMockAuthAdapter, type AuthAdapter } from '@/features/personas/auth'
import { SessionProvider, useSession } from '@/features/personas/Session'
import { DemoResetError } from '@/features/personas/demoReset'
import { TodayDemoChecklist } from './TodayDemoChecklist'

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); window.location.hash = '' })
afterEach(() => vi.restoreAllMocks())

it('puts guide and Kendra first, mounts the parent checklist on Today, and reopens it from the header', async () => {
  render(<App authAdapter={createMockAuthAdapter()} />)
  const picker = screen.getByRole('main')
  const buttons = within(picker).getAllByRole('button').filter(button => button.getAttribute('aria-label')?.startsWith('Explore as'))
  expect(buttons.slice(0, 2).map(button => button.getAttribute('aria-label'))).toEqual(['Explore as the Demo guide', 'Explore as Kendra'])
  expect(screen.getByText('Explore (read-only). Browse everything, nothing changes.')).toBeVisible()
  expect(screen.getByText('Try it as Kendra, the parent, and follow the checklist')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Explore as Kendra' }))
  const today = await screen.findByRole('region', { name: 'Today for Kendra' })
  expect(within(today).getByRole('region', { name: 'Judge checklist' })).toHaveTextContent('historical October 26, 2026 sample')
  expect(within(today).queryByRole('heading', { name: 'Talk to Rosina' })).not.toBeInTheDocument()
  expect(within(today).queryByRole('heading', { name: 'Review photo suggestions' })).not.toBeInTheDocument()
  fireEvent.click(within(today).getByRole('button', { name: 'Dismiss checklist' }))
  expect(within(today).getByRole('button', { name: 'Reopen judge checklist' })).toBeVisible()
  fireEvent.click(within(today).getByRole('button', { name: 'Demo checklist' }))
  await waitFor(() => expect(within(today).getByRole('region', { name: 'Judge checklist' })).toBeVisible())
  fireEvent.click(screen.getByRole('button', { name: 'Switch person' }))
  await screen.findByRole('button', { name: 'Explore as the Demo guide' })
  fireEvent.click(screen.getByRole('button', { name: 'Explore as the Demo guide' }))
  await screen.findByText('Signed in as Demo guide')
  fireEvent.click(screen.getByRole('link', { name: 'Today' }))
  fireEvent(window, new HashChangeEvent('hashchange'))
  const guide = await screen.findByRole('region', { name: 'Judge checklist' })
  expect(guide).toHaveTextContent('Demo guide · read-only exploration')
  expect(within(guide).getAllByRole('checkbox')).toHaveLength(1)
  expect(within(guide).queryByRole('button', { name: 'Reset shared demo…' })).not.toBeInTheDocument()
})

function ResetHarness() {
  const { session, switchPerson, registerResetVerification } = useSession()
  // The real app registers this verification through ResetSeededReads.
  useEffect(() => registerResetVerification(async () => {}), [registerResetVerification])
  return !session ? <button onClick={() => { void switchPerson('kendra') }}>Choose Kendra</button> : <TodayDemoChecklist reopenSignal={0} />
}

it('uses the session reset path; failure preserves progress and success clears it before the next run', async () => {
  const base = createMockAuthAdapter()
  const reset = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new DemoResetError('failed')).mockResolvedValueOnce()
  const adapter: AuthAdapter = { ...base, mode: 'live', resetDemo: reset, signInAsPersona: async id => ({ ...await base.signInAsPersona(id), accessToken: 'test-only', expiresAt: Date.now() / 1000 + 3600, marks: { demo: true, demoGuide: false } }) }
  render(<SessionProvider adapter={adapter}><ResetHarness /></SessionProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Choose Kendra' }))
  const checklist = await screen.findByRole('region', { name: 'Judge checklist' })
  expect(reset).not.toHaveBeenCalled()
  fireEvent.click(within(checklist).getByRole('checkbox', { name: 'I tried this: A school notice changes the plan' }))
  fireEvent.click(within(checklist).getByRole('button', { name: 'Reset shared demo…' }))
  expect(reset).not.toHaveBeenCalled()
  expect(within(checklist).getByText(/resets the shared sandbox for everyone/)).toBeVisible()
  fireEvent.click(within(checklist).getByRole('button', { name: 'Reset demo for everyone' }))
  await waitFor(() => expect(within(checklist).getByRole('alert')).toHaveTextContent('progress is unchanged'))
  expect(within(checklist).getByText(/1 of 2 tried/)).toBeVisible()
  expect(reset).toHaveBeenCalledTimes(1)
  fireEvent.click(within(checklist).getByRole('button', { name: 'Reset demo for everyone' }))
  await screen.findByRole('button', { name: 'Choose Kendra' })
  expect(reset).toHaveBeenCalledTimes(2)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Choose Kendra' })))
  expect((await screen.findByRole('region', { name: 'Judge checklist' })).textContent).toMatch(/0 of 2 tried/)
})
