/**
 * MyChildren — the browser read of the caller's authorized children.
 *
 * `myChildren` is a delivered GraphQL contract (merged #43, ACCESS subgraph):
 * each row is the child the caller holds SOMETHING for, with EXACTLY the scopes
 * held for that child. This module adds the typed browser read that was missing;
 * it runs through the live authed Apollo client (the persona's own bearer) and
 * renders exactly what a fresh read returns.
 *
 * Rules (docs/contracts/design.md; the MyChildren contract):
 *  - No hardcoded roster. The list is whatever the read returns, this session.
 *  - Scopes are per child, NEVER unioned across children.
 *  - A read scope is view access, NEVER authority — nothing here infers
 *    parent/guardian/approval rights from a scope.
 *  - `session.scope.childId` is the current child CONTEXT, not proof of a
 *    single authorized child; it is kept separate from this list.
 */
import { gql, type ApolloClient } from '@apollo/client'
import { useEffect, useState } from 'react'

export const MY_CHILDREN = gql`query WebMyChildren {
  myChildren {
    child { id person { displayName } }
    scopes
  }
}`

export type ChildAccess = {
  id: string
  /** Only ever what the read returned; null when the contract did not disclose a name. */
  displayName: string | null
  /** Exactly the scopes held for THIS child. Never union across children. */
  scopes: string[]
}

type MyChildrenResponse = { myChildren: { child: { id: string; person: { displayName: string | null } | null }; scopes: string[] | null }[] }

const REFUSAL_CODES = new Set(['UNAUTHORIZED', 'UNAUTHENTICATED', 'AUTH_ERROR'])

function codeOf(error: unknown): string | null {
  const withErrors = error as { errors?: { extensions?: { code?: string } }[] }
  const fromExt = withErrors.errors?.find((e) => REFUSAL_CODES.has(e.extensions?.code ?? ''))?.extensions?.code
  if (fromExt) return fromExt
  const message = (error as Error)?.message ?? ''
  return REFUSAL_CODES.has(message) ? message : null
}

/** Runs the read and returns exactly the children it reports. Throws a refusal
 *  code string ('UNAUTHORIZED' | …) so the caller can distinguish refusal from a
 *  transport error; an empty, successful read returns []. */
export async function readMyChildren(client: ApolloClient, runRead: <T>(read: () => Promise<T>) => Promise<T>): Promise<ChildAccess[]> {
  try {
    const data = await runRead(async () => {
      const result = await client.query<MyChildrenResponse>({ query: MY_CHILDREN, fetchPolicy: 'network-only' })
      if (!result.data) throw new Error('No data returned')
      return result.data
    })
    return data.myChildren.map((row) => ({
      id: row.child.id,
      displayName: row.child.person?.displayName ?? null,
      scopes: [...(row.scopes ?? [])],
    }))
  } catch (error) {
    const code = codeOf(error)
    throw code ? new Error(code) : error
  }
}

export type MyChildrenState =
  | { status: 'loading' }
  | { status: 'ready'; children: ChildAccess[] }
  | { status: 'empty' }
  | { status: 'refused' }
  | { status: 'error' }

/**
 * Fresh read on mount and whenever the session generation changes (a persona
 * switch starts a new read; a stale one is dropped). `client` is null outside a
 * live session — the hook reports 'refused' there rather than inventing data.
 */
export function useMyChildren(
  client: ApolloClient | null,
  runRead: <T>(read: () => Promise<T>) => Promise<T>,
  generation: number,
): MyChildrenState {
  const [state, setState] = useState<MyChildrenState>({ status: 'loading' })
  useEffect(() => {
    let active = true
    if (!client) { setState({ status: 'refused' }); return }
    setState({ status: 'loading' })
    readMyChildren(client, runRead).then(
      (children) => { if (active) setState(children.length === 0 ? { status: 'empty' } : { status: 'ready', children }) },
      (error) => {
        if (!active) return
        if (error instanceof Error && error.message === 'SESSION_CHANGED') return
        setState(error instanceof Error && REFUSAL_CODES.has(error.message) ? { status: 'refused' } : { status: 'error' })
      },
    )
    return () => { active = false }
  }, [client, runRead, generation])
  return state
}

/** Human labels for read scopes — presented as view access, never authority. */
const SCOPE_LABEL: Record<string, string> = {
  'schedule.read': 'Schedule',
  'careplan.read': 'Care',
  'school.read': 'School',
  'contacts.read': 'Contacts',
  'transport.read': 'Transport',
  'goals.read': 'Goals',
  'pickup.verify': 'Pickup',
  'pickup.request': 'Pickup requests',
  'supervise.request': 'Supervision',
}
export function scopeLabel(scope: string): string {
  return SCOPE_LABEL[scope] ?? scope.replace(/\.(read|request|verify)$/, '').replace(/[._]/g, ' ')
}
