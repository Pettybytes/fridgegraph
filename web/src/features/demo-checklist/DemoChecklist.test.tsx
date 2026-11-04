import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { DemoChecklist, type DemoChecklistProps } from './DemoChecklist'

const availability = { noticeConfirmReady: true, villageReady: true, orbitReady: true, voiceReady: false, photoReady: false }
const props: DemoChecklistProps = { demoRunId: 'run-a', personaId: 'kendra', childId: 'p_nora', mode: 'parent', availability }

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

it('keeps October 26 separate from today', () => {
  render(<DemoChecklist {...props} />)
  expect(screen.getByText(/historical October 26, 2026 sample/)).toBeVisible()
  expect(screen.getByText(/12:30 PM dismissal conflicts with Nora’s recorded 3:00 PM pickup/)).toBeVisible()
  expect(screen.getByText(/not arranged yet/)).toBeVisible()
  expect(screen.getByRole('link', { name: 'download the PNG' })).toHaveAttribute('href', '/samples/notice-plan/notice-a-early-dismissal.png')
  expect(screen.getByRole('link', { name: 'PDF' })).toHaveAttribute('href', '/samples/notice-plan/notice-a-early-dismissal.pdf')
  expect(screen.queryByRole('heading', { name: 'Talk to Rosina' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Review photo suggestions' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Reset shared demo…' })).not.toBeInTheDocument()
})

it('renders no external receipt links; receipts stay in-app', () => {
  const { container } = render(<DemoChecklist {...props} availability={{ ...availability, voiceReady: true, photoReady: true }} noticeResult={{ jobId: 'pickup_live_123', status: 'discovering', mode: 'live' }} onStartNotice={vi.fn()} />)
  const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href') ?? '')
  expect(hrefs.some(href => href.includes('github.com'))).toBe(false)
  expect(hrefs.some(href => /^https?:\/\//.test(href))).toBe(false)
  expect(screen.queryByText(/receipt$/)).not.toBeInTheDocument()
  // The in-app receipt remains: the recorded job id and the in-app result links.
  expect(screen.getByText(/Pickup request recorded/)).toBeVisible()
  expect(screen.getByRole('link', { name: 'Mission Control — the pickup request' })).toHaveAttribute('href', '#/mission-control')
})

it('shows voice and photo only with readiness flags and credits the copied fixture', () => {
  render(<DemoChecklist {...props} availability={{ ...availability, voiceReady: true, photoReady: true }} />)
  expect(screen.getByRole('heading', { name: 'Talk to Rosina' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Review photo suggestions' })).toBeVisible()
  expect(screen.getByText(/not Muse art/)).toBeVisible()
  expect(screen.getByRole('link', { name: 'fictional outfit sample illustration' })).toHaveAttribute('href', '/samples/demo-checklist/fictional-outfit.png')
  // Under the live gate the notice step is a persisted-state action card, not a tried checkbox.
  expect(screen.getByRole('button', { name: 'Add the school notice' })).toBeVisible()
  expect(screen.queryByRole('checkbox', { name: 'I tried this: A school notice changes the plan' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('checkbox')).toHaveLength(5)
  expect(screen.getByText(/they do not verify an app result/)).toBeVisible()
})

it('renders the notice action card from persisted pickup state, never a checkbox', () => {
  const onStartNotice = vi.fn()
  const { rerender } = render(<DemoChecklist {...props} onStartNotice={onStartNotice} />)
  const start = screen.getByRole('button', { name: 'Add the school notice' })
  expect(screen.getByText(/Not started\. The trigger stages the notice/)).toBeVisible()
  fireEvent.click(start)
  expect(onStartNotice).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('navigation', { name: 'Check the result' })).not.toBeInTheDocument()
  // A mock confirm reports no real record; the card must not claim completion.
  rerender(<DemoChecklist {...props} onStartNotice={onStartNotice} noticeResult={{ jobId: 'mock-pickup:p_nora:2026-10-26:afternoon', status: 'discovering', mode: 'mock' }} />)
  expect(screen.getByText(/No record was created in this build/)).toBeVisible()
  expect(screen.queryByRole('navigation', { name: 'Check the result' })).not.toBeInTheDocument()
  // A live confirm is the persisted completion: the recorded job id + result links appear.
  rerender(<DemoChecklist {...props} onStartNotice={onStartNotice} noticeResult={{ jobId: 'pickup_live_123', status: 'discovering', mode: 'live' }} />)
  expect(screen.getByText(/Pickup request recorded — not arranged yet · pickup_live_123/)).toBeVisible()
  const results = screen.getByRole('navigation', { name: 'Check the result' })
  expect(within(results).getByRole('link', { name: 'Mission Control — the pickup request' })).toHaveAttribute('href', '#/mission-control')
  expect(within(results).getByRole('link', { name: 'Recorded activity' })).toHaveAttribute('href', '#/activity')
  expect(within(results).getByRole('link', { name: 'Family Calendar' })).toHaveAttribute('href', '#/calendar')
})

it('scopes tried progress and dismissal to version, persona, child, and demo run', () => {
  // With the notice action card excluded, the tried checkboxes are village, orbit, and guide.
  const view = render(<DemoChecklist {...props} />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'I tried this: Grow the village with permission' }))
  expect(screen.getByText(/1 of 3 tried/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss checklist' }))
  expect(screen.getByRole('button', { name: 'Reopen judge checklist' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Reopen judge checklist' }))
  expect(screen.getByText(/1 of 3 tried/)).toBeVisible()
  for (const changed of [{ version: '2' }, { personaId: 'andre' }, { childId: 'p_jax' }, { demoRunId: 'run-b' }]) {
    view.rerender(<DemoChecklist {...props} {...changed} />)
    expect(screen.getByText(/0 of 3 tried/)).toBeVisible()
  }
  view.rerender(<DemoChecklist {...props} />)
  expect(screen.getByText(/1 of 3 tried/)).toBeVisible()
})

it('handles denied storage and keeps the guide path read-only', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const onReset = vi.fn(async () => true)
  render(<DemoChecklist {...props} personaId="demo-guide" mode="guide" onReset={onReset} />)
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  expect(screen.getByRole('heading', { name: 'Explore the showcase' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Reset shared demo…' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'I tried this: Explore the showcase' }))
  expect(screen.getByText(/1 of 1 tried/)).toBeVisible()
  expect(onReset).not.toHaveBeenCalled()
})

it('calls authorized reset only on click and clears progress only after success', async () => {
  let finish!: (value: boolean) => void
  const onReset = vi.fn().mockImplementationOnce(() => new Promise<boolean>(done => { finish = done })).mockResolvedValueOnce(true)
  render(<DemoChecklist {...props} onReset={onReset} />)
  expect(onReset).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'I tried this: Grow the village with permission' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reset shared demo…' }))
  expect(screen.getByText(/resets the shared sandbox for everyone/)).toBeVisible()
  expect(onReset).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Reset demo for everyone' }))
  expect(screen.getByText(/1 of 3 tried/)).toBeVisible()
  expect(screen.getByText(/Resetting the demo/)).toBeVisible()
  await act(async () => finish(false))
  expect(screen.getByRole('alert')).toHaveTextContent('progress is unchanged')
  expect(screen.getByText(/1 of 3 tried/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Reset demo for everyone' }))
  await waitFor(() => expect(screen.getByText(/0 of 3 tried/)).toBeVisible())
  expect(onReset).toHaveBeenCalledTimes(2)
})
