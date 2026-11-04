import { gql, type ApolloClient } from '@apollo/client'
import { useEffect, useState } from 'react'

const RESOURCE = gql`query LocalWebResource($key: String!) { webResource(key: $key) }`
type Snapshot<T> = { value?: T; error?: string }
type Owner = { epoch: number; flights: Map<string, Promise<unknown>>; listeners: Set<() => void> }
const owners = new WeakMap<ApolloClient, Owner>()
function owner(client: ApolloClient): Owner {
  let state = owners.get(client)
  if (!state) {
    state = { epoch: 0, flights: new Map(), listeners: new Set() }
    owners.set(client, state)
    client.onClearStore(async () => { state!.epoch++; state!.flights.clear(); for (const notify of state!.listeners) notify() })
  }
  return state
}
export function invalidateResources(client:ApolloClient) {
  const state=owner(client)
  state.epoch++;state.flights.clear()
}
export function resourceSnapshot<T>(client: ApolloClient, key: string): Snapshot<T> | undefined {
  return client.cache.readQuery<{ webResource: Snapshot<T> }>({ query: RESOURCE, variables: { key } })?.webResource
}
export function storeResource<T>(client:ApolloClient,key:string,value:T) {
 client.cache.writeQuery({query:RESOURCE,variables:{key},data:{webResource:{value}}})
 for(const notify of owner(client).listeners)notify()
}
export function refreshResource<T>(client: ApolloClient, key: string, load: () => Promise<T>): Promise<T> {
  const state = owner(client), existing = state.flights.get(key)
  if (existing) return existing as Promise<T>
  const epoch = state.epoch
  const publish = (snapshot: Snapshot<T>) => {
    if (state.epoch !== epoch) return
    client.cache.writeQuery({ query: RESOURCE, variables: { key }, data: { webResource: snapshot } })
    for (const notify of state.listeners) notify()
  }
  const request = Promise.resolve().then(load).then(value => { publish({ value }); return value }, error => {
    // A refusal must remove old private data, never leave it looking current.
    publish({ error: error instanceof Error ? error.message : 'READ_UNAVAILABLE' })
    throw error
  }).finally(() => { if (state.flights.get(key) === request) state.flights.delete(key) })
  state.flights.set(key, request)
  return request
}
/** One session-owned Apollo cache. Keys include surface + child + read parameters.
 * Revisits synchronously render the snapshot, then revalidate with one in-flight read.
 */
export function useCachedResource<T>(client: ApolloClient | null, key: string, load: () => Promise<T>, interval = 0) {
  const [, render] = useState(0)
  useEffect(() => {
    if (!client) return
    const state = owner(client), notify = () => render(n => n + 1)
    state.listeners.add(notify)
    const refresh = () => { void refreshResource(client, key, load).catch(() => {}) }
    refresh()
    const changed = () => { if (!document.hidden) refresh() }
    window.addEventListener('frontend:changed', changed)
    const timer = interval ? window.setInterval(changed, interval) : undefined
    return () => { state.listeners.delete(notify); clearInterval(timer); window.removeEventListener('frontend:changed', changed) }
  }, [client, key, load, interval])
  return client ? resourceSnapshot<T>(client, key) : undefined
}
