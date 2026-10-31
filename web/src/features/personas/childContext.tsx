/**
 * Child-access context — the shared, typed source of "who is the caller allowed
 * to see, and which child are they looking at right now."
 *
 * Three separate ideas, deliberately not conflated (MyChildren contract):
 *  - `authorized`: the fresh MyChildren read — every child the caller holds
 *    something for, each with its OWN scopes (never unioned, never authority).
 *  - `sessionChildId`/Name: the session's scope child (the "home" child).
 *  - `selectedChildId`/Name + `selectChild`: the child currently FOCUSED in the
 *    signature Village/Today views. It defaults to the session child and can be
 *    moved — but only to a child the authorized read actually returned. Selecting
 *    a child is a view focus, not a re-scope and not a grant; it confers nothing.
 *
 * Consumed by Today and the signature Village/Orbit components so they share one
 * read and one selection without re-fetching or guessing.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ApolloClient } from '@apollo/client'
import { useMyChildren, type MyChildrenState } from './myChildren'

export type ChildAccessValue = {
  sessionChildId: string
  sessionChildName: string
  /** Focused child for Today/Village (defaults to the session child). */
  selectedChildId: string
  selectedChildName: string
  /** Focus a child. No-ops for an id not in `authorized` (no arbitrary scoping). */
  selectChild: (id: string) => void
  authorized: MyChildrenState
  /** The live authed Apollo client + read wrapper, so a consumer can render a
   * connected reader (e.g. AuthorizedVillagePreview) without prop-drilling. Null
   * client outside a live session. */
  client: ApolloClient | null
  runRead: <T>(read: () => Promise<T>) => Promise<T>
}

const ChildAccessContext = createContext<ChildAccessValue | null>(null)

export function ChildAccessProvider({
  client, selectedChildId: sessionChildId, selectedChildName: sessionChildName, runRead, generation, children,
}: {
  client: ApolloClient | null
  selectedChildId: string
  selectedChildName: string
  runRead: <T>(read: () => Promise<T>) => Promise<T>
  generation: number
  children: ReactNode
}) {
  const authorized = useMyChildren(client, runRead, generation)
  const [focusedId, setFocusedId] = useState(sessionChildId)
  // A new persona (generation) resets focus to that session's child.
  useEffect(() => { setFocusedId(sessionChildId) }, [generation, sessionChildId])

  const selectChild = useCallback((id: string) => {
    setFocusedId((current) => {
      if (id === sessionChildId) return id
      const ok = authorized.status === 'ready' && authorized.children.some((c) => c.id === id)
      return ok ? id : current
    })
  }, [authorized, sessionChildId])

  const value = useMemo<ChildAccessValue>(() => {
    const focusedName =
      focusedId === sessionChildId
        ? sessionChildName
        : (authorized.status === 'ready' && authorized.children.find((c) => c.id === focusedId)?.displayName) || sessionChildName
    return { sessionChildId, sessionChildName, selectedChildId: focusedId, selectedChildName: focusedName, selectChild, authorized, client, runRead }
  }, [sessionChildId, sessionChildName, focusedId, selectChild, authorized, client, runRead])

  return <ChildAccessContext.Provider value={value}>{children}</ChildAccessContext.Provider>
}

/** Null outside a signed-in session; consumers should guard. */
export function useChildAccess(): ChildAccessValue | null {
  return useContext(ChildAccessContext)
}
