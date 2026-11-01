import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useRosinaVoice, type VoiceDeps, type RecorderLike, type AudioLike } from './useRosinaVoice'

const TURN_OK = { transcript: 'hello rosina', reply: 'Hi Kendra', actions: [], models: { asr: 'muse-voice-transcribe-1.0', tts: 'eleven_multilingual_v2', voice: 'uG1JFy6xppqckhHCs2KG', rosina: null }, audioBase64: 'QUJD', mimeType: 'audio/mpeg' }

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

function okFetch(body: unknown = TURN_OK, status = 200) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string) => { calls.push(url); return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response })
  return { fetchMock: fetchMock as unknown as typeof fetch, calls }
}

afterEach(() => vi.clearAllMocks())

it('single buffered turn: idle → listening → processing → speaking → idle', async () => {
  const { deps, endAudio } = makeDeps()
  const { fetchMock, calls } = okFetch()
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  expect(result.current.state).toBe('idle')
  await act(async () => { await result.current.start() })
  expect(result.current.state).toBe('listening')
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.state).toBe('speaking'))
  expect(result.current.transcript).toBe('hello rosina')
  expect(result.current.reply).toBe('Hi Kendra')
  expect(calls).toEqual(['/voice/turn']) // ONE buffered call, no transcribe+turn fan-out
  act(() => { endAudio() })
  expect(result.current.state).toBe('idle')
})

it('a denied microphone surfaces a plain, actionable error and never records', async () => {
  const { deps } = makeDeps({ getUserMedia: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))) })
  const { result } = renderHook(() => useRosinaVoice(deps))
  await act(async () => { await result.current.start() })
  expect(result.current.state).toBe('error')
  expect(result.current.error?.kind).toBe('mic-denied')
})

it('a 429 becomes "Rosina needs a moment"', async () => {
  const { deps } = makeDeps()
  const { fetchMock } = okFetch({ error: 'RATE_LIMITED' }, 429)
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.state).toBe('error'))
  expect(result.current.error?.kind).toBe('rate-limited')
})

it('a rejected autoplay surfaces needs-play, and Play reply then plays', async () => {
  const { deps, audio } = makeDeps()
  audio.play.mockRejectedValueOnce(new DOMException('autoplay', 'NotAllowedError')).mockResolvedValue(undefined)
  const { fetchMock } = okFetch()
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.state).toBe('needs-play'))
  await act(async () => { result.current.playReply() })
  await waitFor(() => expect(result.current.state).toBe('speaking'))
})

it('never shows a transcript the server did not return', async () => {
  const { deps } = makeDeps()
  const { fetchMock } = okFetch({ transcript: '  ', reply: 'x' })
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.state).toBe('error'))
  expect(result.current.transcript).toBeNull()
})

it('reports into the conversation once, with no duplicate Rosina turn and no auto-confirm', async () => {
  const onTranscript = vi.fn(), onReply = vi.fn()
  const { deps, endAudio } = makeDeps()
  const { fetchMock, calls } = okFetch({ ...TURN_OK, actions: [{ id: 'start-pickup', args: {} }] })
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock, onTranscript, onReply }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.reply).toBe('Hi Kendra'))
  act(() => { endAudio() })
  expect(calls).toEqual(['/voice/turn'])                 // exactly one turn — no second model call
  expect(onTranscript).toHaveBeenCalledTimes(1)
  expect(onReply).toHaveBeenCalledWith('Hi Kendra', [{ id: 'start-pickup', args: {} }]) // action exposed, not confirmed
})

it('a persona/child change discards an in-flight late result and resets', async () => {
  let resolveTurn!: (r: unknown) => void
  const pending = new Promise((r) => { resolveTurn = r })
  const fetchMock = vi.fn(() => pending) as unknown as typeof fetch
  const { deps } = makeDeps()
  const { result, rerender } = renderHook(({ k }) => useRosinaVoice({ ...deps, request: fetchMock, resetKey: k }), { initialProps: { k: 'kendra:nora' } })
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })        // → processing, request in flight
  await waitFor(() => expect(result.current.state).toBe('processing'))
  rerender({ k: 'priya:malik' })                          // persona switch tears down
  // The old turn now resolves — it must be discarded, not shown in the new perspective.
  await act(async () => { resolveTurn({ ok: true, status: 200, json: async () => TURN_OK }); await Promise.resolve() })
  expect(result.current.transcript).toBeNull()
  expect(result.current.reply).toBeNull()
  expect(result.current.state).not.toBe('speaking')
})
