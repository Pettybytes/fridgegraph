import { lazy, Suspense, useMemo } from 'react'
import type { AuthAdapter } from '@/features/personas/auth'
import { createMockAuthAdapter } from '@/features/personas/auth'
import { createLiveAuthAdapter } from '@/features/personas/liveAuth'
import { SessionProvider, useSession } from '@/features/personas/Session'
import { PersonaPicker, SandboxBanner } from '@/features/personas/PersonaPicker'
import { GuideDirectory } from '@/features/personas/GuideDirectory'
import { RouteSkeleton } from '@/app/RouteSkeleton'
const SignedInVillage = lazy(() => import('@/app/SignedInVillage'))
function Entry({ orbitNow }: { orbitNow: () => number }) {
  const { session, switching } = useSession()
  if (!session || switching) return <PersonaPicker />
  return <Suspense fallback={<RouteSkeleton />}><SignedInVillage orbitNow={orbitNow} /></Suspense>
}
export default function App({authAdapter,orbitNow=Date.now}:{authAdapter?:AuthAdapter;orbitNow?:()=>number}={}) {
  const auth = useMemo(() => authAdapter ?? (import.meta.env.DEV && import.meta.env.VITE_DEV_MOCK_AUTH==='true'?createMockAuthAdapter():createLiveAuthAdapter()), [authAdapter])
  return <SessionProvider adapter={auth}><SandboxBanner /><GuideDirectory><Entry orbitNow={orbitNow} /></GuideDirectory></SessionProvider>
}
