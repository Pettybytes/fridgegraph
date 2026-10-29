import { act, cleanup, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { DataProvider, useSurfaceData } from './provider'
import { createMockAdapter, demoScope } from './mockAdapter'
import type { VillageData } from './types'
function VillageProbe() {
  const { data } = useSurfaceData<VillageData>('village')
  return <p>{data ? `${data.frontendSnapshot.nodes.length} village members` : 'Loading'}</p>
}
it('routes village reads through the injected adapter and polls at 30 seconds', async () => {
  vi.useFakeTimers()
  try {
    const adapter = createMockAdapter()
    const read = vi.spyOn(adapter, 'readVillage')
    const chatRead = vi.spyOn(adapter, 'readParentChat')
    render(<DataProvider adapter={adapter} scope={demoScope}><VillageProbe /></DataProvider>)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('8 village members')).toBeVisible()
    expect(read).toHaveBeenCalledWith(demoScope)
    await act(async () => { await vi.advanceTimersByTimeAsync(29999) })
    expect(read).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(read).toHaveBeenCalledTimes(2)
    expect(chatRead).not.toHaveBeenCalled()
  } finally {
    cleanup()
    vi.useRealTimers()
  }
})
