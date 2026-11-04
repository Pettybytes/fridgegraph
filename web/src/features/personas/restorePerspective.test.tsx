import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockAuthAdapter } from './auth'
import type { AuthAdapter } from './auth'
import { SessionProvider, useSession } from './Session'

function Controls() {
  const { session, switching, switchPerson, resetDemo } = useSession()
  return (
    <>
      <button onClick={() => { void switchPerson('kendra') }}>Kendra</button>
      <button onClick={() => { void switchPerson('rosa') }}>Rosa</button>
      <button onClick={() => { void switchPerson() }}>Switch person</button>
      <button onClick={() => { void resetDemo() }}>Reset</button>
      {switching ? <p>Switching</p> : session ? <p>Signed in as {session.persona.name}</p> : <p>Picker</p>}
    </>
  )
}
const storageDump = () => {
  const entries: Array<[string, string | null]> = []
  for (const store of [sessionStorage, localStorage]) for (let i = 0; i < store.length; i++) { const key = store.key(i)!; entries.push([key, store.getItem(key)]) }
  return JSON.stringify(entries)
}
/** Mock sign-ins carry a token the way live ones do, so the storage assertions bite. */
function tokenBearingAdapter(): AuthAdapter {
  const auth = createMockAuthAdapter(), real = auth.signInAsPersona
  auth.signInAsPersona = async (id, signal) => ({ ...await real(id, signal), accessToken: 'test-only-session', expiresAt: Date.now() / 1000 + 3600, marks: { demo: true, demoGuide: false } })
  return auth
}

describe('perspective survives a reload without a token in storage', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); window.history.replaceState(null, '', '/') })

  it('remembers only the persona id after a sign-in', async () => {
    render(<SessionProvider adapter={tokenBearingAdapter()}><Controls /></SessionProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Kendra' }))
    await screen.findByText('Signed in as Kendra')
    expect(sessionStorage.getItem('fg:perspective')).toBe('kendra')
    const dump = storageDump()
    expect(dump).not.toContain('test-only-session')
    expect(dump).not.toContain('accessToken')
  })

  it('restores the remembered persona on the route the reload arrived on', async () => {
    sessionStorage.setItem('fg:perspective', 'kendra')
    window.location.hash = '#/orbit'
    const auth = tokenBearingAdapter(), signIn = vi.spyOn(auth, 'signInAsPersona')
    render(<SessionProvider adapter={auth}><Controls /></SessionProvider>)
    await screen.findByText('Signed in as Kendra')
    expect(signIn).toHaveBeenCalledWith('kendra', expect.anything())
    expect(window.location.hash).toBe('#/orbit')
  })

  it('a restore never redirects an arrival route to the persona initialRoute', async () => {
    // Rosa's initialRoute is calendar; a reload on orbit must stay on orbit.
    sessionStorage.setItem('fg:perspective', 'rosa')
    window.location.hash = '#/orbit'
    render(<SessionProvider adapter={createMockAuthAdapter()}><Controls /></SessionProvider>)
    await screen.findByText('Signed in as Rosa Castellano')
    expect(window.location.hash).toBe('#/orbit')
  })

  it('a restore with an empty hash still applies the persona initialRoute', async () => {
    sessionStorage.setItem('fg:perspective', 'rosa')
    render(<SessionProvider adapter={createMockAuthAdapter()}><Controls /></SessionProvider>)
    await screen.findByText('Signed in as Rosa Castellano')
    expect(window.location.hash).toBe('#/calendar')
  })

  it('a fresh pick (not a restore) still honours the persona initialRoute', async () => {
    window.location.hash = '#/orbit'
    render(<SessionProvider adapter={createMockAuthAdapter()}><Controls /></SessionProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Rosa' }))
    await screen.findByText('Signed in as Rosa Castellano')
    expect(window.location.hash).toBe('#/calendar')
  })

  it('shows the picker when the re-pick fails', async () => {
    sessionStorage.setItem('fg:perspective', 'kendra')
    const auth = createMockAuthAdapter()
    auth.signInAsPersona = vi.fn().mockRejectedValue(new Error('demo login unavailable'))
    render(<SessionProvider adapter={auth}><Controls /></SessionProvider>)
    await waitFor(() => expect(auth.signInAsPersona).toHaveBeenCalled())
    await screen.findByText('Picker')
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument()
  })

  it('ignores a remembered value that is not a known persona id', async () => {
    sessionStorage.setItem('fg:perspective', 'p_mom; drop table')
    const auth = createMockAuthAdapter(), signIn = vi.spyOn(auth, 'signInAsPersona')
    render(<SessionProvider adapter={auth}><Controls /></SessionProvider>)
    await screen.findByText('Picker')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(signIn).not.toHaveBeenCalled()
  })

  it('switching perspective forgets the remembered persona', async () => {
    render(<SessionProvider adapter={createMockAuthAdapter()}><Controls /></SessionProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Kendra' }))
    await screen.findByText('Signed in as Kendra')
    fireEvent.click(screen.getByRole('button', { name: 'Switch person' }))
    await screen.findByText('Picker')
    expect(sessionStorage.getItem('fg:perspective')).toBeNull()
  })

  it('a demo reset forgets the remembered persona while the open session continues', async () => {
    render(<SessionProvider adapter={createMockAuthAdapter()}><Controls /></SessionProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Kendra' }))
    await screen.findByText('Signed in as Kendra')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(sessionStorage.getItem('fg:perspective')).toBeNull())
    expect(screen.getByText('Signed in as Kendra')).toBeVisible()
  })
})
