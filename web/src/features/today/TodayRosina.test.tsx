import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from '@/App'
import { createMockAuthAdapter } from '@/features/personas/auth'

beforeEach(() => { window.location.hash = '' })

async function enterToday() {
  render(<App authAdapter={createMockAuthAdapter()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Explore as Kendra' }))
  await screen.findByText('Signed in as Kendra')
  return screen.findByRole('region', { name: /Today for Kendra/ })
}

it('sends the typed Today question once into the existing Rosina conversation', async () => {
  const today = await enterToday()
  const entry = within(today).getByPlaceholderText(/calendar today/)
  fireEvent.change(entry, { target: { value: 'What can I do here?' } })
  fireEvent.click(within(today).getByRole('button', { name: 'Ask Rosina' }))

  const panel = screen.getByRole('region', { name: 'Ask Rosina' })
  const conversation = within(panel).getByRole('log', { name: 'Rosina conversation' })
  await waitFor(() => expect(within(conversation).getAllByText('What can I do here?')).toHaveLength(1))
  await waitFor(() => expect(within(conversation).getAllByText('Rosina')).toHaveLength(1))
  expect(within(conversation).getAllByText('You')).toHaveLength(1)
  expect(entry).toHaveValue('')
  expect(panel).toHaveClass('is-open')
})

it('opens the one shared mic and starts capture from the gesture, without sending a turn', async () => {
  // The Today mic opens Rosina AND starts capture on the SAME shared controller (one mic, no second
  // recording). jsdom has no real microphone, so getUserMedia is the observable start signal.
  const getUserMedia = vi.fn(() => Promise.reject(new DOMException('no mic', 'NotFoundError')))
  const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  try {
    const today = await enterToday()
    fireEvent.click(within(today).getByRole('button', { name: 'Open Rosina microphone' }))
    const panel = screen.getByRole('region', { name: 'Ask Rosina' })
    expect(panel).toHaveClass('is-open')
    // Exactly ONE mic control is mounted (the shared controller, not a second one).
    expect(within(panel).getAllByRole('button', { name: /talking to Rosina|Stop and send/ })).toHaveLength(1)
    // Capture was initiated from the user gesture…
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    // …but starting to listen is NOT sending a turn: no 'You' message was appended.
    expect(within(within(panel).getByRole('log', { name: 'Rosina conversation' })).queryByText('You', { exact: true })).not.toBeInTheDocument()
  } finally {
    if (original) Object.defineProperty(navigator, 'mediaDevices', original)
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices
  }
})

it('drops a late Today question after leaving the perspective', async () => {
  const today = await enterToday()
  let oldDetail: unknown
  const capture = (event: Event) => { oldDetail = (event as CustomEvent).detail }
  window.addEventListener('rosina:send-from-today', capture, { once: true })
  fireEvent.change(within(today).getByPlaceholderText(/calendar today/), { target: { value: 'What can I do here?' } })
  fireEvent.click(within(today).getByRole('button', { name: 'Ask Rosina' }))
  await waitFor(() => expect(oldDetail).toBeDefined())

  fireEvent.click(screen.getByRole('button', { name: 'Switch person' }))
  await screen.findByRole('button', { name: 'Explore as Loretta' })
  fireEvent(window, new CustomEvent('rosina:send-from-today', { detail: oldDetail }))
  expect(screen.queryByRole('log', { name: 'Rosina conversation' })).not.toBeInTheDocument()
  expect(screen.queryByText('What can I do here?')).not.toBeInTheDocument()
})

it('rejects a Today question stamped for another child or generation', async () => {
  await enterToday()
  fireEvent(window, new CustomEvent('rosina:send-from-today', { detail: { message: 'Private question', generation: -1, childId: 'p_nora' } }))
  fireEvent(window, new CustomEvent('rosina:send-from-today', { detail: { message: 'Private question', generation: 1, childId: 'p_other' } }))
  expect(screen.getByRole('region', { name: 'Ask Rosina' })).not.toHaveClass('is-open')
  expect(screen.getByRole('log', { name: 'Rosina conversation' })).not.toHaveTextContent('Private question')
})
