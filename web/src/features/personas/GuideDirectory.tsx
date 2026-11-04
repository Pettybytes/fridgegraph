import { useMemo, useEffect, type ReactNode } from 'react'
import { createGraphClient } from '@/lib/frontendData/graphqlAdapter'
import { ChildAccessProvider, useChildAccess } from './childContext'
import { SessionContext, useSession } from './Session'

/** View focus only. The bearer and the server's authority never change with this selector. */
export function GuideDirectory({ children }: { children: ReactNode }) {
  const context = useSession()
  const { session, getCurrentSession, getSessionGeneration, runRead } = context
  const client = useMemo(() => session?.marks?.demoGuide
    ? createGraphClient(async () => getCurrentSession()?.accessToken ?? null, undefined, getSessionGeneration)
    : null, [session?.generation, getCurrentSession, getSessionGeneration])
  useEffect(() => () => { client?.stop() }, [client])
  if (!session?.marks?.demoGuide || !client) return children
  return <ChildAccessProvider client={client} selectedChildId={session.scope.childId} selectedChildName={session.scope.childName} runRead={runRead} generation={session.generation}>
    <FocusedGuide>{children}</FocusedGuide>
  </ChildAccessProvider>
}
function FocusedGuide({ children }: { children: ReactNode }) {
  const context = useSession(), access = useChildAccess()!
  const session = context.session!
  const focused = useMemo(() => ({ ...context, session: { ...session, scope: {
    ...session.scope, childId: access.selectedChildId, childName: access.selectedChildName,
  } } }), [context, session, access.selectedChildId, access.selectedChildName])
  return <SessionContext.Provider value={focused}>
    <div key={access.selectedChildId}>{children}</div>
  </SessionContext.Provider>
}
/** Keep the guide directory outside remounted page readers when its focus changes. */
export function PageChildAccess(props: Parameters<typeof ChildAccessProvider>[0]) {
  const existing = useChildAccess()
  return existing ? props.children : <ChildAccessProvider {...props} />
}

export function GuideChildSelector() {
 const {session}=useSession(),access=useChildAccess()
 if(!session?.marks?.demoGuide||!access)return null
 return <label className="guide-child-selector">Viewing <select aria-label="Demo guide child" value={access.selectedChildId} onChange={event=>access.selectChild(event.target.value)}>
  {access.authorized.status==='ready'?access.authorized.children.map(child=><option key={child.id} value={child.id}>{child.displayName}</option>):<option value={session.scope.childId}>{session.scope.childName}</option>}
 </select></label>
}
