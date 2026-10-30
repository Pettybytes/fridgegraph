import { createContext, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { AuthAdapter, AuthSession, DemoFamily, DemoFamilyInput, PersonaId } from './auth'
type Cleanup = () => void | Promise<unknown>
type SessionContextValue = {
  session: AuthSession | null; switching: boolean; error: string; families: DemoFamily[]
  switchPerson(id?: PersonaId): Promise<void>
  resetDemo(): Promise<void>
  createDemoFamily(input: DemoFamilyInput): Promise<void>
  registerPrivateCleanup(cleanup: Cleanup): () => void
}
const Context = createContext<SessionContextValue | null>(null)
export function SessionProvider({ adapter, children }: { adapter: AuthAdapter; children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  const [families, setFamilies] = useState<DemoFamily[]>([])
  const generation = useRef(0)
  const cleanups = useRef(new Set<Cleanup>())
  async function transition(id?: PersonaId, reset = false) {
    const current = ++generation.current
    // Snapshot before unmount. Synchronously remove private DOM before awaiting any service.
    const pendingCleanup = [...cleanups.current]
    cleanups.current.clear()
    flushSync(() => { setSession(null); setSwitching(true); setError(''); setFamilies([]) })
    try {
      await Promise.all(pendingCleanup.map(clear => clear()))
      if (reset) await adapter.resetDemo()
      const next = id ? await adapter.signInAsPersona(id) : null
      if (current === generation.current) setSession(next ? { ...next, generation: current } : null)
    } catch { if (current === generation.current) setError('Unable to load this demo person. Try again.') }
    finally { if (current === generation.current) setSwitching(false) }
  }
  async function createDemoFamily(input: DemoFamilyInput) {
    const current = generation.current
    const family = await adapter.createDemoFamily(input)
    if (current === generation.current) setFamilies(items => [...items, family])
  }
  return <Context.Provider value={{ session, switching, error, families, switchPerson: id => transition(id), resetDemo: () => transition(undefined, true), createDemoFamily, registerPrivateCleanup: cleanup => { cleanups.current.add(cleanup); return () => { cleanups.current.delete(cleanup) } } }}>{children}</Context.Provider>
}
export function useSession() {
  const value = useContext(Context)
  if (!value) throw new Error('SessionProvider is required')
  return value
}
