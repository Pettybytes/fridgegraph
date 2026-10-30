import type { ReactNode } from 'react'
import { createClient } from '@supabase/supabase-js'
import { createGraphClient, createGraphqlAdapter } from './graphqlAdapter'
import type { FrontendAdapter, Scope } from './types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
// Live transport; no mock fallback and no demo credentials. W2/W4 supply the real login.
const supabase = supabaseUrl && publishableKey ? createClient(supabaseUrl, publishableKey) : null
export const graphClient = createGraphClient(async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null)
export const graphqlAdapter = createGraphqlAdapter(graphClient)
export function ConnectedEntry({ children, scope }: { children: (adapter: FrontendAdapter, scope: Scope) => ReactNode; scope?: Scope }) {
  // The demo-login service must supply the scope. Never ask families to enter internal IDs.
  if (scope) return children(graphqlAdapter, scope)
  return <main className="connected-entry"><h1>Demo sign-in isn’t available yet</h1><p>You’ll be able to choose a person when demo sign-in is connected. Your village information will stay private until then.</p><p>Demo village. Calls and texts go to test responders.</p></main>
}
