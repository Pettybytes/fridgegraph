import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql, type ApolloCache } from '@apollo/client'
import { ApolloProvider, useQuery } from '@apollo/client/react'
import type { FrontendAdapter, MissionControlData, ParentChatData, Scope, VillageData } from './types'

// These documents are LOCAL adapter messages, never operations sent to the graph.
// A real adapter composes primitive GraphQL reads via Apollo Client behind this seam.
export const SNAPSHOT = gql`query LocalFrontendSnapshot($scope: FrontendScope!, $surface: String!) {
  frontendSnapshot(scope: $scope, surface: $surface)
}`
export const POLL_INTERVAL_MS = 2500
export const VILLAGE_POLL_INTERVAL_MS = 30000
const DataContext = createContext<{ scope: Scope; mode: FrontendAdapter['mode']; adapter: FrontendAdapter } | null>(null)
export function DataProvider({ adapter, scope, children, cache }: { adapter: FrontendAdapter; scope: Scope; children: ReactNode; cache?: ApolloCache }) {
  const client = useMemo(() => new ApolloClient({
    cache: cache ?? new InMemoryCache(),
    dataMasking: true,
    link: new ApolloLink(operation => new Observable(observer => {
      let active = true
      const request = operation.variables.surface === 'mission-control'
        ? adapter.readMissionControl(operation.variables.scope)
        : operation.variables.surface === 'village'
          ? adapter.readVillage(operation.variables.scope)
          : adapter.readParentChat?.(operation.variables.scope) ?? Promise.reject(new Error('UNAVAILABLE'))
      request.then(frontendSnapshot => {
        if (active) { observer.next({ data: { frontendSnapshot } }); observer.complete() }
      }, error => { if (active) observer.error(error) })
      return () => { active = false }
    })),
  }), [adapter, cache])
  return <DataContext.Provider value={{ scope, mode: adapter.mode, adapter }}><ApolloProvider client={client}>{children}</ApolloProvider></DataContext.Provider>
}
export function useDataContext() {
  const context = useContext(DataContext)
  if (!context) throw new Error('DataProvider is required')
  return context
}
export function useSurfaceData<T extends MissionControlData | ParentChatData | VillageData>(surface: 'mission-control' | 'parent-chat' | 'village') {
  const { scope } = useDataContext()
  const result = useQuery<{ frontendSnapshot: T }>(SNAPSHOT, {
    variables: { scope, surface }, pollInterval: surface === 'village' ? VILLAGE_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
    fetchPolicy: 'cache-and-network', notifyOnNetworkStatusChange: false,
    skipPollAttempt: () => document.visibilityState === 'hidden',
  })
  useEffect(() => {
    if (result.error && /UNAUTHORIZED|UNAUTHENTICATED|AUTH_ERROR/.test(result.error.message)) result.stopPolling()
  }, [result.error, result.stopPolling])
  useEffect(() => {
    const refresh=()=>{void result.refetch().catch(()=>{})}
    window.addEventListener('frontend:changed',refresh)
    return()=>window.removeEventListener('frontend:changed',refresh)
  },[result.refetch])
  return { ...result, loading: result.loading && !result.data }
}
export function dataErrorMessage(error: { message: string }): string {
  if(error.message.includes('DEMO_GUIDE_READ_ONLY'))return 'This action is available only in the showcase family'
  if(error.message.includes('DEMO_OUTREACH_REFUSED'))return 'Calls and texts stay in the demo sandbox.'
  if (error.message.includes('UNAVAILABLE')) return 'This view has nothing to show for this perspective yet.'
  if (error.message.includes('UNAUTHENTICATED') || error.message.includes('AUTH_ERROR')) return 'Your perspective needs a fresh session. Please try again in a moment.'
  if (error.message.includes('UNAUTHORIZED')) return "You don't have access to this."
  return 'Updates stalled just now. They keep retrying on their own.'
}
