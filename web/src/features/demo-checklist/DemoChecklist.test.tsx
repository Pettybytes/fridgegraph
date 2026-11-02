import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DemoChecklist, type DemoChecklistProps } from './DemoChecklist'
import { DEMO_CHECKLIST_EVIDENCE } from './evidence'

const availability = { noticeConfirmReady: true, villageReady: true, orbitReady: true, voiceReady: false, photoReady: false }
const props: DemoChecklistProps = { demoRunId: 'run-a', personaId: 'kendra', childId: 'p_nora', mode: 'parent', availability, evidenceLinks: DEMO_CHECKLIST_EVIDENCE }

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

it('uses real evidence paths and keeps October 26 separate from today', () => {
  for (const href of Object.values(DEMO_CHECKLIST_EVIDENCE)) {
    const path = new URL(href).pathname.split('/blob/main/')[1]
    expect(path).toMatch(/^docs\/evidence\//)
    expect(existsSync(resolve(process.cwd(), '..', path))).toBe(true)
  }
  render(<DemoChecklist {...props} />)
  expect(screen.getByText(/historical October 26, 2026 sample/)).toBeVisible()
  expect(screen.getByText(/12:30 PM dismissal conflicts with Nora’s recorded 3:00 PM pickup/)).toBeVisible()
  expect(screen.getByText(/not arranged yet/)).toBeVisible()
  expect(screen.getByRole('link', { name: 'download the PNG' })).toHaveAttribute('href', '/samples/notice-plan/notice-a-early-dismissal.png')
  expect(screen.getByRole('link', { name: 'PDF' })).toHaveAttribute('href', '/samples/notice-plan/notice-a-early-dismissal.pdf')
  expect(screen.queryByRole('heading', { name: 'Talk to Rosina' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Review photo suggestions' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Reset demo and checklist' })).not.toBeInTheDocument()
})

it('shows voice and photo only with readiness flags and credits the copied fixture', () => {
  render(<DemoChecklist {...props} availability={{ ...availability, voiceReady: true, photoReady: true }} />)
  expect(screen.getByRole('heading', { name: 'Talk to Rosina' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Review photo suggestions' })).toBeVisible()
  expect(screen.getByText(/not Muse art/)).toBeVisible()
  expect(screen.getByRole('link', { name: 'fictional outfit sample illustration' })).toHaveAttribute('href', '/samples/demo-checklist/fictional-outfit.png')
  expect(screen.getAllByRole('checkbox')).toHaveLength(6)
  expect(screen.getByText(/they do not verify an app result/)).toBeVisible()
})

it('scopes tried progress and dismissal to version, persona, child, and demo run', () => {
  const view = render(<DemoChecklist {...props} />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'I tried this: A school notice changes the plan' }))
  expect(screen.getByText(/1 of 4 tried/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss checklist' }))
  expect(screen.getByRole('button', { name: 'Reopen judge checklist' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Reopen judge checklist' }))
  expect(screen.getByText(/1 of 4 tried/)).toBeVisible()
  for (const changed of [{ version: '2' }, { personaId: 'andre' }, { childId: 'p_jax' }, { demoRunId: 'run-b' }]) {
    view.rerender(<DemoChecklist {...props} {...changed} />)
    expect(screen.getByText(/0 of 4 tried/)).toBeVisible()
  }
  view.rerender(<DemoChecklist {...props} />)
  expect(screen.getByText(/1 of 4 tried/)).toBeVisible()
})

it('handles denied storage and keeps the guide path read-only', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const onReset = vi.fn(async () => true)
  render(<DemoChecklist {...props} personaId="demo-guide" mode="guide" onReset={onReset} />)
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  expect(screen.getByRole('heading', { name: 'Explore read-only' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Reset demo and checklist' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'I tried this: Explore read-only' }))
  expect(screen.getByText(/1 of 1 tried/)).toBeVisible()
  expect(onReset).not.toHaveBeenCalled()
})

it('calls authorized reset only on click and clears progress only after success', async () => {
  let finish!: (value: boolean) => void
  const onReset = vi.fn().mockImplementationOnce(() => new Promise<boolean>(done => { finish = done })).mockResolvedValueOnce(true)
  render(<DemoChecklist {...props} onReset={onReset} />)
  expect(onReset).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'I tried this: A school notice changes the plan' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reset demo and checklist' }))
  expect(screen.getByText(/1 of 4 tried/)).toBeVisible()
  expect(screen.getByText(/Resetting the demo/)).toBeVisible()
  await act(async () => finish(false))
  expect(screen.getByRole('alert')).toHaveTextContent('progress is unchanged')
  expect(screen.getByText(/1 of 4 tried/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Reset demo and checklist' }))
  await waitFor(() => expect(screen.getByText(/0 of 4 tried/)).toBeVisible())
  expect(onReset).toHaveBeenCalledTimes(2)
})
