import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DataProvider, useSurfaceData, dataErrorMessage } from './provider'
import { createMockAdapter, demoScope } from './mockAdapter'
import type { ParentChatData } from './types'
function Probe() {
  const { data, loading, error } = useSurfaceData<ParentChatData>('parent-chat')
  if (loading) return <p>Loading</p>
  if (error) return <p>{dataErrorMessage(error)}</p>
  return <p>{data?.frontendSnapshot.messages[0]?.text}</p>
}
describe('adapter bridge', () => {
  it('renders an injected adapter result and refreshes through Apollo polling', async () => {
    const adapter = createMockAdapter()
    const read = vi.spyOn(adapter, 'readParentChat')
    vi.useFakeTimers()
    try {
      render(<DataProvider adapter={adapter} scope={demoScope}><Probe /></DataProvider>)
      // Flush the initial read and Apollo's deferred polling setup on the same clock.
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.getByText(/can someone grab Nora/)).toBeVisible()
      await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
      expect(read).toHaveBeenCalledTimes(2)
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })
  it('renders forbidden scope without retrying as a network error', async () => {
    const adapter = createMockAdapter()
    const read = vi.spyOn(adapter, 'readParentChat')
    render(<DataProvider adapter={adapter} scope={{ ...demoScope, childId: 'other' }}><Probe /></DataProvider>)
    await waitFor(() => expect(screen.getByText("You don't have access to this.")).toBeVisible())
    expect(read).toHaveBeenCalledTimes(1)
  })
})

it('renders a revisited surface from cache while its fresh read is still pending', async () => {
  const adapter = createMockAdapter()
  const read = vi.spyOn(adapter, 'readParentChat')
  const tree = (visible: boolean) => <DataProvider adapter={adapter} scope={demoScope}>{visible ? <Probe /> : null}</DataProvider>
  const mounted = render(tree(true))
  await screen.findByText(/can someone grab Nora/)
  mounted.rerender(tree(false))
  read.mockImplementation(() => new Promise(() => {}))
  mounted.rerender(tree(true))
  expect(screen.getByText(/can someone grab Nora/)).toBeVisible()
  expect(screen.queryByText('Loading')).not.toBeInTheDocument()
})
