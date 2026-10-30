import { lazy, Suspense } from 'react'
import { Shell } from '@/app/Shell'
import { DataProvider } from '@/lib/frontendData/provider'
import { demoScope } from '@/lib/frontendData/mockAdapter'
import { MissionControl } from '@/features/mission-control'
import { createPickupDemoAdapter } from '@/features/mission-control/demoAdapter'
import '@/app/village-route.css'
import { ConnectedEntry } from '@/lib/frontendData/ConnectedEntry'
import type { FrontendAdapter, Scope } from '@/lib/frontendData/types'

const LivingVillage = lazy(() => import('@/features/village').then(module => ({ default: module.LivingVillage })))
const adapter = createPickupDemoAdapter()

function Workspace({ source, scope }: { source: FrontendAdapter; scope: Scope }) {
  return <DataProvider adapter={source} scope={scope}>
    <Shell slots={{
      'mission-control': <MissionControl />,
      village: <Suspense fallback={<p className="village-route-loading" role="status">Loading the village…</p>}>
        <section className="village-route" aria-label="Living Village workspace"><LivingVillage /></section>
      </Suspense>,
    }} />
  </DataProvider>
}

export default function App() {
  const mode = import.meta.env.VITE_DATA_MODE ?? 'mock'
  if (mode === 'graphql') return <ConnectedEntry>{(source, scope) => <Workspace source={source} scope={scope} />}</ConnectedEntry>
  if (mode !== 'mock') return <p role="alert">Unknown data mode. Choose mock or graphql.</p>
  return <Workspace source={adapter} scope={demoScope} />
}
