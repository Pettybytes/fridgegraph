import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApolloClient, ApolloLink, InMemoryCache, gql } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import App from '@/App'
import { createMockAuthAdapter, personas } from './auth'
import { SessionProvider, useSession } from './Session'
import { ApolloSessionCleanup } from './ApolloSessionCleanup'
import { createPersonaDataAdapter } from './personaData'
function Controls() {
  const { session, switchPerson, switching } = useSession()
  return <><button onClick={() => { void switchPerson('kendra') }}>Kendra</button><button onClick={() => { void switchPerson('loretta') }}>Loretta</button><p>{session?.persona.name ?? (switching ? 'Switching' : 'Entry')}</p>{session && <ApolloSessionCleanup />}</>
}
describe('persona sessions', () => {
  it('clears private DOM synchronously and clears Apollo before loading the next persona', async () => {
    const auth = createMockAuthAdapter(), cache = new InMemoryCache()
    const client = new ApolloClient({ cache, link: ApolloLink.empty() })
    const secret = gql`query LocalPrivate { privateSelection }`
    client.writeQuery({ query: secret, data: { privateSelection: 'Kendra private selection' } })
    const clear = vi.spyOn(client, 'clearStore')
    const signIn = vi.spyOn(auth, 'signInAsPersona')
    render(<ApolloProvider client={client}><SessionProvider adapter={auth}><Controls /></SessionProvider></ApolloProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Kendra' }))
    await waitFor(() => expect(screen.getAllByText('Kendra')).toHaveLength(2))
    let atLoad: unknown
    signIn.mockImplementationOnce(async id => {
      atLoad = { id, clearCalls: clear.mock.calls.length, cached: client.readQuery({ query: secret }), kendraNodes: screen.queryAllByText('Kendra').length }
      return createMockAuthAdapter().signInAsPersona(id)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Loretta' }))
    expect(screen.getByText('Switching')).toBeVisible()
    await waitFor(() => expect(screen.getAllByText('Loretta')).toHaveLength(2))
    expect(atLoad).toEqual({ id: 'loretta', clearCalls: 1, cached: null, kendraNodes: 1 })
  })
  it('ignores a superseded sign-in response', async () => {
    const auth = createMockAuthAdapter(), real = auth.signInAsPersona
    let resolveKendra!: (value: Awaited<ReturnType<typeof real>>) => void
    auth.signInAsPersona = id => id === 'kendra' ? new Promise(resolve => { resolveKendra = resolve }) : real(id)
    const client = new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.empty() })
    render(<ApolloProvider client={client}><SessionProvider adapter={auth}><Controls /></SessionProvider></ApolloProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Kendra' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Loretta' }))
    await waitFor(() => expect(screen.getAllByText('Loretta')).toHaveLength(2))
    await act(async () => resolveKendra(await real('kendra')))
    expect(screen.getAllByText('Loretta')).toHaveLength(2)
    expect(screen.queryByText('Switching')).not.toBeInTheDocument()
  })
  it('removes Kendra pickup data before Loretta renders', async () => {
    window.location.hash = ''
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Kendra/ }))
    await screen.findByRole('button', { name: 'Select Tasha Ellison' })
    fireEvent.click(screen.getByRole('button', { name: 'Switch person' }))
    expect(screen.queryByRole('button', { name: 'Select Tasha Ellison' })).not.toBeInTheDocument()
    expect(screen.queryByText('Signed in as Kendra')).not.toBeInTheDocument()
    await screen.findByRole('button', { name: /Loretta/ })
    fireEvent.click(screen.getByRole('button', { name: /Loretta/ }))
    await screen.findByText('Signed in as Loretta')
    expect(screen.queryByRole('button', { name: 'Select Tasha Ellison' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent("Pickup plans are shared with Nora's parents")
  })
  it('clears a selected person from the route before switching', async () => {
    window.location.hash = ''
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Kendra/ }))
    await screen.findByText('Signed in as Kendra')
    window.history.replaceState(null, '', '#/village?person=p_tasha')
    fireEvent.click(screen.getByRole('button', { name: 'Switch person' }))
    expect(window.location.hash).toBe('#/mission-control')
  })
  it('gives Priya care information without parent jobs or pickup approval', async () => {
    const raw = await createMockAuthAdapter().signInAsPersona('priya')
    expect(raw.persona.grants).toEqual(['supervise.request', 'schedule.read', 'careplan.read'])
    const adapter = createPersonaDataAdapter({ ...raw, generation: 1 })
    await expect(adapter.readMissionControl(raw.scope)).rejects.toThrow('UNAUTHORIZED')
    expect(adapter.approvePickup).toBeUndefined()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Priya/ }))
    const boundary = await screen.findByRole('alert')
    expect(boundary).toHaveTextContent("You can see Nora's schedule and care information.")
    fireEvent.click(screen.getByRole('link', { name: 'Open care information' }))
    fireEvent(window, new HashChangeEvent('hashchange'))
    expect(await screen.findByText('Peanut allergy. Epi-pen in right backpack pocket.')).toBeVisible()
    expect(screen.getByText("Source: Nora's care plan")).toBeVisible()
    expect(screen.queryByText(/added by Kendra|src\/|fixture/)).not.toBeInTheDocument()
    expect(screen.queryByText('Tasha Ellison')).not.toBeInTheDocument()
  })
  it('makes no backend family facts and validates names', async () => {
    const auth = createMockAuthAdapter()
    await expect(auth.createDemoFamily({ parentName: '', childName: 'Child' })).rejects.toThrow('Enter a parent')
    expect(await auth.createDemoFamily({ parentName: 'Fictional Parent', childName: 'Fictional Child' })).toMatchObject({ id: 'mock-family-1', parentName: 'Fictional Parent' })
    await auth.resetDemo()
    expect((await auth.createDemoFamily({ parentName: 'Parent', childName: 'Child' })).id).toBe('mock-family-1')
    expect(personas).toHaveLength(10)
  })
})
