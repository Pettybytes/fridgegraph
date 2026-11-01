import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useRosinaVoice, type VoiceDeps, type RecorderLike, type AudioLike } from './useRosinaVoice'

// ── Controllable platform stubs ─────────────────────────────────────────────
function makeDeps(over: Partial<VoiceDeps> = {}) {
  let fireData: ((b: Blob) => void) | null = null
  const recorder: RecorderLike = { state: 'recording', start: vi.fn(), stop: vi.fn(() => fireData?.(new Blob(['x'], { type: 'audio/webm' }))) }
  const audio: AudioLike & { play: ReturnType<typeof vi.fn> } = { play: vi.fn(() => Promise.resolve()), pause: vi.fn(), currentTime: 0, onended: null }
  const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
  const deps: VoiceDeps = {
    getAccessToken: () => 'TOKEN',
    getUserMedia: vi.fn(() => Promise.resolve(stream)),
    createRecorder: (_s, onData) => { fireData = onData; return recorder },
    createMeter: () => ({ level: () => 0.5, stop: vi.fn() }),
    createAudio: () => audio,
    ...over,
  }
  return { deps, recorder, audio, endAudio: () => audio.onended?.() }
}

/** A fetch that answers /voice/transcribe then /voice/turn from a script. */
function scriptFetch(steps: { transcribe?: [number, unknown]; turn?: [number, unknown] }) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url)
    const [status, body] = url.includes('/voice/transcribe') ? (steps.transcribe ?? [200, { text: 'hello rosina' }]) : (steps.turn ?? [200, { reply: 'Hi Kendra', actions: [], models: { asr: 'muse-voice-transcribe-1.0', tts: 'eleven_multilingual_v2', voice: 'uG1JFy6xppqckhHCs2KG' }, audioBase64: 'QUJD', mimeType: 'audio/mpeg' }])
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
  })
  return { fetchMock: fetchMock as unknown as typeof fetch, calls }
}

afterEach(() => vi.clearAllMocks())

it('runs the full state machine: idle → listening → transcribing → thinking → speaking → idle', async () => {
  const { deps, endAudio } = makeDeps()
  const { fetchMock } = scriptFetch({})
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  expect(result.current.state).toBe('idle')

  await act(async () => { await result.current.start() })
  expect(result.current.state).toBe('listening')

  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.transcript).toBe('hello rosina'))
  await waitFor(() => expect(result.current.reply).toBe('Hi Kendra'))
  await waitFor(() => expect(result.current.state).toBe('speaking'))
  expect(result.current.models?.voice).toBe('uG1JFy6xppqckhHCs2KG')

  act(() => { endAudio() })
  expect(result.current.state).toBe('idle')
})

it('a denied microphone surfaces a plain, actionable error and never records', async () => {
  const { deps } = makeDeps({ getUserMedia: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))) })
  const { result } = renderHook(() => useRosinaVoice(deps))
  await act(async () => { await result.current.start() })
  expect(result.current.state).toBe('error')
  expect(result.current.error?.kind).toBe('mic-denied')
  expect(result.current.error?.message).toMatch(/allow it/i)
})

it('a 429 becomes "Rosina needs a moment", not a crash', async () => {
  const { deps } = makeDeps()
  const { fetchMock } = scriptFetch({ transcribe: [429, { error: 'RATE_LIMITED' }] })
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.state).toBe('error'))
  expect(result.current.error?.kind).toBe('rate-limited')
  expect(result.current.error?.message).toMatch(/needs a moment/i)
})

it('never shows a transcript the server did not return', async () => {
  const { deps } = makeDeps()
  const { fetchMock } = scriptFetch({ transcribe: [200, { text: '   ' }] }) // empty/whitespace
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.state).toBe('error'))
  expect(result.current.transcript).toBeNull()
  expect(result.current.reply).toBeNull()
})

it('never auto-confirms: a reply with an action is exposed but no action/confirm call is made', async () => {
  const { deps, endAudio } = makeDeps()
  const { fetchMock, calls } = scriptFetch({ turn: [200, { reply: 'I can prepare that', actions: [{ id: 'start-pickup', args: {} }], audioBase64: 'QUJD', mimeType: 'audio/mpeg' }] })
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.actions).toHaveLength(1))
  act(() => { endAudio() })
  // Exactly the two voice calls happened — no third call to confirm/activate anything.
  expect(calls).toEqual(['/voice/transcribe', '/voice/turn'])
})

it('stop-audio control halts playback and returns to idle', async () => {
  const { deps, audio } = makeDeps()
  const { fetchMock } = scriptFetch({})
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.state).toBe('speaking'))
  act(() => { result.current.stopAudio() })
  expect(audio.pause).toHaveBeenCalled()
  expect(result.current.state).toBe('idle')
})
