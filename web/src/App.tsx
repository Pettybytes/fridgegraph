import { Shell } from '@/app/Shell'
import { DataProvider } from '@/lib/frontendData/provider'
import { demoScope } from '@/lib/frontendData/mockAdapter'
import { MissionControl } from '@/features/mission-control'
import { createPickupDemoAdapter } from '@/features/mission-control/demoAdapter'
const adapter = createPickupDemoAdapter()
export default function App() {
  return <DataProvider adapter={adapter} scope={demoScope}><Shell slots={{ 'mission-control': <MissionControl /> }} /></DataProvider>
}
