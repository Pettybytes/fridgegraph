import { ApolloClient, ApolloLink, InMemoryCache, Observable, type FetchResult } from '@apollo/client'
import { expect, it } from 'vitest'
import { readMyChildren, scopeLabel } from './myChildren'

const pass = <T>(read: () => Promise<T>) => read()
const clientReturning = (data: unknown) =>
  new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink(() => new Observable<FetchResult>((o) => { o.next({ data: data as Record<string, unknown> }); o.complete() })) })
const clientErroring = (err: Error) =>
  new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink(() => new Observable<FetchResult>((o) => o.error(err))) })

it('renders exactly the children returned, with displayName and per-child scopes NOT unioned', async () => {
  const client = clientReturning({ myChildren: [
    { child: { id: 'p_malik', person: { displayName: 'Malik Ferris' } }, scopes: ['careplan.read'] },
    { child: { id: 'p_nora', person: { displayName: 'Nora Ellison' } }, scopes: ['careplan.read', 'schedule.read'] },
  ] })
  const children = await readMyChildren(client, pass)
  expect(children).toEqual([
    { id: 'p_malik', displayName: 'Malik Ferris', scopes: ['careplan.read'] },
    { id: 'p_nora', displayName: 'Nora Ellison', scopes: ['careplan.read', 'schedule.read'] },
  ])
  // The careplan-only child never inherits the other child's schedule scope.
  expect(children[0].scopes).not.toContain('schedule.read')
  client.stop()
})

it('an authorized empty read returns [] (not a refusal)', async () => {
  const client = clientReturning({ myChildren: [] })
  expect(await readMyChildren(client, pass)).toEqual([])
  client.stop()
})

it('a missing displayName is kept null, never invented', async () => {
  const client = clientReturning({ myChildren: [{ child: { id: 'p_x', person: null }, scopes: ['schedule.read'] }] })
  expect((await readMyChildren(client, pass))[0].displayName).toBeNull()
  client.stop()
})

it('a refusal surfaces as its code, distinct from a transport error', async () => {
  const refused = clientErroring(Error('UNAUTHORIZED'))
  await expect(readMyChildren(refused, pass)).rejects.toThrow('UNAUTHORIZED')
  refused.stop()
})

it('scope labels present read access, never authority wording', () => {
  expect(scopeLabel('careplan.read')).toBe('Care')
  expect(scopeLabel('schedule.read')).toBe('Schedule')
  expect(scopeLabel('pickup.verify')).toBe('Pickup')
  expect(scopeLabel('careplan.read')).not.toMatch(/approve|owner|authority|manage/i)
})
