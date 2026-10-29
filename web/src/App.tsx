import { lazy, Suspense } from 'react'
import { Shell } from '@/app/Shell'
import { DataProvider } from '@/lib/frontendData/provider'
import { demoScope } from '@/lib/frontendData/mockAdapter'
import { MissionControl } from '@/features/mission-control'
import { createPickupDemoAdapter } from '@/features/mission-control/demoAdapter'
import '@/app/village-route.css'

const LivingVillage = lazy(() => import('@/features/village').then(module => ({ default: module.LivingVillage })))
const adapter = createPickupDemoAdapter()

export default function App() {
  return <DataProvider adapter={adapter} scope={demoScope}>
    <Shell slots={{
      'mission-control': <MissionControl />,
      village: <Suspense fallback={<p className="village-route-loading" role="status">Loading the village…</p>}>
        <section className="village-route" aria-label="Living Village workspace"><LivingVillage /></section>
      </Suspense>,
    }} />
  </DataProvider>
}
