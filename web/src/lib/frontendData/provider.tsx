import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client'
import { ApolloProvider, useQuery } from '@apollo/client/react'
import type { FrontendAdapter, MissionControlData, ParentChatData, Scope, VillageData } from './types'

// These documents are LOCAL adapter messages, never operations sent to the graph.
// A real adapter composes primitive GraphQL reads via Apollo Client behind this seam.
const SNAPSHOT = gql`query LocalFrontendSnapshot($scope: FrontendScope!, $surface: String!) {
  frontendSnapshot(scope: $scope, surface: $surface)
}`
export const POLL_INTERVAL_MS = 2500
export const VILLAGE_POLL_INTERVAL_MS = 30000
const DataContext = createContext<{ scope: Scope; mode: FrontendAdapter['mode'] } | null>(null)
export function DataProvider({ adapter, scope, children }: { adapter: FrontendAdapter; scope: Scope; children: ReactNode }) {
  const client = useMemo(() => new ApolloClient({
    cache: new InMemoryCache(),
    dataMasking: true,
    link: new ApolloLink(operation => new Observable(observer => {
      let active = true
      const request = operation.variables.surface === 'mission-control'
        ? adapter.readMissionControl(operation.variables.scope)
        : operation.variables.surface === 'village'
          ? adapter.readVillage(operation.variables.scope)
          : adapter.readParentChat(operation.variables.scope)
      request.then(frontendSnapshot => {
        if (active) { observer.next({ data: { frontendSnapshot } }); observer.complete() }
      }, error => { if (active) observer.error(error) })
      return () => { active = false }
    })),
  }), [adapter])
  return <DataContext.Provider value={{ scope, mode: adapter.mode }}><ApolloProvider client={client}>{children}</ApolloProvider></DataContext.Provider>
}
export function useDataContext() {
  const context = useContext(DataContext)
  if (!context) throw new Error('DataProvider is required')
  return context
}
export function useSurfaceData<T extends MissionControlData | ParentChatData | VillageData>(surface: 'mission-control' | 'parent-chat' | 'village') {
  const { scope } = useDataContext()
  return useQuery<{ frontendSnapshot: T }>(SNAPSHOT, {
    variables: { scope, surface }, pollInterval: surface === 'village' ? VILLAGE_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
    fetchPolicy: 'network-only', notifyOnNetworkStatusChange: false,
    skipPollAttempt: () => document.visibilityState === 'hidden',
  })
}
export function dataErrorMessage(error: { message: string }): string {
  if (error.message.includes('UNAUTHENTICATED') || error.message.includes('AUTH_ERROR')) return 'Sign in again to continue.'
  if (error.message.includes('UNAUTHORIZED')) return "You don't have access to this."
  return 'Unable to load updates. Try again.'
}
