import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { VoicePanel } from './RosinaVoiceButton'

const deps = {
  getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [] } as unknown as MediaStream)),
  createRecorder: () => ({ start: vi.fn(), stop: vi.fn(), state: 'inactive' }),
  createMeter: () => ({ level: () => 0, stop: vi.fn() }),
}

it('renders a labelled, keyboard-operable mic button and the provider credit, with no transcript at rest', () => {
  render(<VoicePanel getAccessToken={() => 'TOKEN'} deps={deps} />)
  const mic = screen.getByRole('button', { name: 'Start talking to Rosina' })
  expect(mic).toBeTruthy()
  expect(mic.tagName).toBe('BUTTON') // native, keyboard-operable
  expect(mic.getAttribute('aria-pressed')).toBe('false')
  // The required provider credit line is present.
  expect(screen.getByText(/Rosina listens with Muse Voice Transcribe and thinks with Muse Spark; her voice is ElevenLabs\./)).toBeTruthy()
  // A voice-replies toggle exists (voice is additive; text input stays the alternative in the panel).
  expect(screen.getByRole('button', { name: /Voice replies/ })).toBeTruthy()
  // No transcript or reply is shown before any real voice state.
  expect(screen.queryByText(/^You /)).toBeNull()
})

it('a single TAP starts capture; a touch gesture never starts a (clippable) recording on its own', async () => {
  const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [] } as unknown as MediaStream))
  const tapDeps = { getUserMedia, createRecorder: () => ({ start: vi.fn(), stop: vi.fn(), state: 'recording' }), createMeter: () => ({ level: () => 0, stop: vi.fn() }) }
  render(<VoicePanel getAccessToken={() => 'TOKEN'} deps={tapDeps} />)
  const mic = screen.getByRole('button', { name: 'Start talking to Rosina' })
  // A touch-start/-end gesture must NOT begin capture (the old behavior could clip a short tap).
  fireEvent.touchStart(mic); fireEvent.touchEnd(mic)
  expect(getUserMedia).not.toHaveBeenCalled()
  // A tap (click) starts listening; the label flips to the stop-and-send affordance.
  fireEvent.click(mic)
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
  await screen.findByRole('button', { name: 'Stop and send' })
})

it('offers a persistent conversation control', () => {
  render(<VoicePanel getAccessToken={() => 'TOKEN'} deps={deps} />)
  expect(screen.getByRole('button', { name: /Start conversation/ })).toBeTruthy()
})
