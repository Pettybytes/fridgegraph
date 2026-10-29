import { Shell } from '@/app/Shell'
import { DataProvider } from '@/lib/frontendData/provider'
import { createMockAdapter, demoScope } from '@/lib/frontendData/mockAdapter'
const adapter = createMockAdapter()
export default function App() {
  return <DataProvider adapter={adapter} scope={demoScope}><Shell /></DataProvider>
}
