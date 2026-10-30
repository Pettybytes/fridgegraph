import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createClient } from '@supabase/supabase-js'
import { createGraphClient, createGraphqlAdapter } from './graphqlAdapter'
import type { FrontendAdapter, Scope } from './types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
// Live transport; no mock fallback and no demo credentials. W2/W4 supply the real login.
const supabase = supabaseUrl && publishableKey ? createClient(supabaseUrl, publishableKey) : null
export const graphClient = createGraphClient(async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null)
export const graphqlAdapter = createGraphqlAdapter(graphClient)
export function ConnectedEntry({ children }: { children: (adapter: FrontendAdapter, scope: Scope) => ReactNode }) {
  const [scope, setScope] = useState<Scope | null>(null)
  const [error, setError] = useState('')
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    if (!supabase || !(await supabase.auth.getSession()).data.session) { setError('Sign in again to continue. Demo login is unavailable until the service is delivered.'); return }
    setScope({ childId: String(values.get('childId')), villageId: String(values.get('villageId')), childName: 'Selected child', parentName: 'Signed-in person' })
  }
  if (scope) return children(graphqlAdapter, scope)
  return <main className="connected-entry"><h1>Connect your village</h1><p>Use your existing Supabase session. The graph checks access to every record.</p><form onSubmit={connect}><label>Child ID<input name="childId" required /></label><label>Village ID<input name="villageId" required /></label><button type="submit">Open village</button></form>{error && <p role="alert">{error}</p>}<p>Demo village. Calls and texts go to test responders.</p></main>
}
