import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useRosinaVoice, type VoiceDeps, type RecorderLike, type AudioLike } from './useRosinaVoice'

const TURN_OK = { transcript: 'hello rosina', reply: 'Hi Kendra', actions: [], models: { asr: 'muse-voice-transcribe-1.0', tts: 'eleven_multilingual_v2', voice: 'uG1JFy6xppqckhHCs2KG', rosina: null }, audioBase64: 'QUJD', mimeType: 'audio/mpeg' }

function makeDeps(over: Partial<VoiceDeps> = {}) {
  let fireData: ((b: Blob) => void) | null = null
  const recorder: RecorderLike = { state: 'recording', start: vi.fn(() => { recorder.state = 'recording' }), stop: vi.fn(() => { recorder.state = 'inactive'; fireData?.(new Blob(['x'], { type: 'audio/webm' })) }) }
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

it('sends the bounded conversation history with the turn (X-Rosina-History)', async () => {
  const { deps } = makeDeps()
  let captured: Record<string, string> | undefined
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => { captured = init.headers as Record<string, string>; return { ok: true, status: 200, json: async () => TURN_OK } as unknown as Response }) as unknown as typeof fetch
  const getHistory = () => [{ role: 'user' as const, content: 'earlier q' }, { role: 'assistant' as const, content: 'earlier a' }]
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock, getHistory }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(captured).toBeTruthy())
  const decoded = JSON.parse(decodeURIComponent(escape(atob(captured!['X-Rosina-History']))))
  expect(decoded).toEqual([{ role: 'user', content: 'earlier q' }, { role: 'assistant', content: 'earlier a' }])
})

it('keeps the text answer when TTS fails and offers a speech-only retry — no second Rosina turn', async () => {
  const onReply = vi.fn()
  const { deps } = makeDeps()
  const bodies: Record<string, unknown> = {
    '/voice/turn': { ...TURN_OK, audioBase64: null, mimeType: null, ttsError: 'TTS_UNAVAILABLE' },
    '/voice/speak': { audioBase64: 'QUJD', mimeType: 'audio/mpeg' },
  }
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string) => { calls.push(url); return { ok: true, status: 200, json: async () => bodies[url] } as unknown as Response }) as unknown as typeof fetch
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock, onReply }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.state).toBe('audio-unavailable'))
  expect(result.current.reply).toBe('Hi Kendra')      // text answer preserved
  expect(onReply).toHaveBeenCalledTimes(1)
  await act(async () => { await result.current.retrySpeak() })
  await waitFor(() => expect(result.current.state).toBe('speaking'))
  expect(calls).toEqual(['/voice/turn', '/voice/speak']) // re-synthesized only; Rosina never re-run
  expect(onReply).toHaveBeenCalledTimes(1)
})

it('a tap during speech stops playback and starts a new listening turn', async () => {
  const { deps, audio } = makeDeps()
  const { fetchMock } = okFetch()
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.state).toBe('speaking'))
  await act(async () => { result.current.toggle() })   // barge-in
  expect(audio.pause).toHaveBeenCalled()
  await waitFor(() => expect(result.current.state).toBe('listening'))
})

it('conversation mode re-arms listening only AFTER playback actually completes', async () => {
  const { deps, endAudio } = makeDeps()
  const gum = deps.getUserMedia as ReturnType<typeof vi.fn>
  const { fetchMock } = okFetch()
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { result.current.startConversation() })
  await waitFor(() => expect(result.current.state).toBe('listening'))
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.state).toBe('speaking'))
  expect(gum).toHaveBeenCalledTimes(1)                 // NOT re-armed while speaking
  act(() => { endAudio() })
  await waitFor(() => expect(result.current.state).toBe('listening'))
  expect(gum).toHaveBeenCalledTimes(2)                 // re-armed after playback ended
  await act(async () => { result.current.endConversation() })
  expect(result.current.state).toBe('idle')
})

it('releases the microphone if permission resolves AFTER cancellation', async () => {
  const track = { stop: vi.fn() }
  let resolveMedia!: (s: MediaStream) => void
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const getUserMedia = vi.fn(() => new Promise<MediaStream>((r) => { resolveMedia = r }))
  const { deps } = makeDeps({ getUserMedia })
  const { result } = renderHook(() => useRosinaVoice(deps))
  let startP!: Promise<void>
  act(() => { startP = result.current.start() })        // awaiting getUserMedia
  act(() => { result.current.cancel() })                // torn down while pending
  await act(async () => { resolveMedia(stream); await startP })
  expect(track.stop).toHaveBeenCalled()                 // acquired stream released immediately
  expect(result.current.state).toBe('idle')
})

it('auto-sends on end-of-speech (silence after speech); silence alone is never sent', async () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  try {
    // (a) speech then silence → auto-send
    let clock = 0
    const meterA = { level: () => (clock <= 100 ? 0.5 : 0), stop: vi.fn() }
    const a = makeDeps({ createMeter: () => meterA, now: () => clock, vad: { speechThreshold: 0.08, silenceMs: 100, minMs: 0, maxMs: 10000 } })
    const fa = okFetch()
    const ra = renderHook(() => useRosinaVoice({ ...a.deps, request: fa.fetchMock }))
    await act(async () => { await ra.result.current.start() })
    const flushA = (t: number) => { clock = t; const cb = frames.shift(); if (cb) act(() => cb(clock)) }
    flushA(50); flushA(100); flushA(170); flushA(260) // silence crosses the 100ms window after speech
    await waitFor(() => expect(fa.calls).toEqual(['/voice/turn']))

    // (b) pure silence → the TIMER-based cap stops the recording even though rAF never runs (a
    // background tab), and silence is never sent.
    frames.length = 0
    const meterB = { level: () => 0, stop: vi.fn() }
    const b = makeDeps({ createMeter: () => meterB, vad: { speechThreshold: 0.08, silenceMs: 5000, minMs: 0, maxMs: 30 } })
    const fb = okFetch()
    const rb = renderHook(() => useRosinaVoice({ ...b.deps, request: fb.fetchMock }))
    await act(async () => { await rb.result.current.start() })
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) }) // let the setTimeout cap fire
    await waitFor(() => expect(rb.result.current.state).toBe('idle'))
    expect(meterB.stop).toHaveBeenCalled() // the cap stopped capture with no animation frame at all
    expect(fb.calls).toEqual([]) // silence is never sent
  } finally {
    vi.unstubAllGlobals()
  }
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

it('single-flight: rapid taps during permission acquisition acquire the mic only once', async () => {
  let resolveMedia!: (s: MediaStream) => void
  const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
  const getUserMedia = vi.fn(() => new Promise<MediaStream>((r) => { resolveMedia = r }))
  const { deps } = makeDeps({ getUserMedia })
  const { fetchMock } = okFetch()
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  act(() => { void result.current.start(); void result.current.start(); void result.current.start() })
  expect(getUserMedia).toHaveBeenCalledTimes(1) // the 2nd/3rd taps are blocked while one is acquiring
  await act(async () => { resolveMedia(stream) })
  expect(result.current.state).toBe('listening')
  expect(getUserMedia).toHaveBeenCalledTimes(1)
})

it('enabling conversation while already listening adopts the recording (no second stream)', async () => {
  const { deps } = makeDeps()
  const gum = deps.getUserMedia as ReturnType<typeof vi.fn>
  const { fetchMock } = okFetch()
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { await result.current.start() })
  expect(result.current.state).toBe('listening'); expect(gum).toHaveBeenCalledTimes(1)
  await act(async () => { result.current.startConversation() })
  expect(result.current.conversation).toBe(true)
  expect(result.current.state).toBe('listening')
  expect(gum).toHaveBeenCalledTimes(1) // adopted the in-flight recording, did not re-acquire
})

it('hiding the tab stops capture and does NOT auto-restart on return', async () => {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const { deps } = makeDeps({ getUserMedia: vi.fn(() => Promise.resolve(stream)) })
  const { fetchMock } = okFetch()
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { result.current.startConversation() })
  await waitFor(() => expect(result.current.state).toBe('listening'))
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(result.current.state).toBe('idle')
  expect(result.current.conversation).toBe(false) // conversation ended; no auto-restart
  expect(track.stop).toHaveBeenCalled()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(result.current.state).toBe('idle') // returning visible does not restart capture
})

it('a late playback resolution after teardown never flips to speaking', async () => {
  let resolvePlay!: () => void
  const { deps, audio } = makeDeps()
  audio.play = vi.fn(() => new Promise<void>((r) => { resolvePlay = r }))
  const { fetchMock } = okFetch()
  const { result } = renderHook(() => useRosinaVoice({ ...deps, request: fetchMock }))
  await act(async () => { await result.current.start() })
  await act(async () => { result.current.stop() })
  await waitFor(() => expect(result.current.reply).toBe('Hi Kendra')) // turn done; play() pending
  expect(result.current.state).not.toBe('speaking')                   // speaking not set before play resolves
  await act(async () => { result.current.cancel() })
  await act(async () => { resolvePlay(); await Promise.resolve() })    // late play resolves after teardown
  expect(result.current.state).not.toBe('speaking')                   // epoch check dropped it
})

function failingThenOkFetch(failures: number) {
  let remaining = failures
  const fetchMock = vi.fn(async () => {
    if (remaining > 0) {
      remaining -= 1
      const res = { ok: false, status: 500, json: async () => ({ error: 'ROSINA_UNAVAILABLE' }), clone() { return res } }
      return res as unknown as Response
    }
    return { ok: true, status: 200, json: async () => TURN_OK } as unknown as Response
  })
  return fetchMock as unknown as typeof fetch
}

it('conversation mode recovers from ONE failed turn: error shown, then re-arms and the next turn succeeds', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const { deps } = makeDeps()
    const request = failingThenOkFetch(1) // ONE mock across re-renders, or remaining resets every render
    const { result } = renderHook(() => useRosinaVoice({ ...deps, request }))
    await act(async () => { result.current.startConversation() })
    expect(result.current.state).toBe('listening')
    await act(async () => { result.current.stop() })
    expect(result.current.state).toBe('error')
    expect(result.current.error?.kind).toBe('model')
    expect(result.current.conversation).toBe(true)            // one failure does not end the conversation
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(result.current.state).toBe('listening')            // re-armed
    vi.useRealTimers()                                        // the success turn needs no fake clock
    await act(async () => { result.current.stop() })
    await waitFor(() => expect(result.current.reply).toBe('Hi Kendra')) // the next turn went through
    expect(result.current.conversation).toBe(true)
  } finally { vi.useRealTimers() }
})

it('three consecutive failed turns end the conversation instead of looping the microphone forever', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const { deps } = makeDeps()
    const request = failingThenOkFetch(99)
    const { result } = renderHook(() => useRosinaVoice({ ...deps, request }))
    await act(async () => { result.current.startConversation() })
    for (let i = 0; i < 2; i += 1) {
      await act(async () => { result.current.stop() })
      expect(result.current.conversation).toBe(true)
      await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
      expect(result.current.state).toBe('listening')
    }
    await act(async () => { result.current.stop() })          // third consecutive failure
    expect(result.current.state).toBe('error')
    expect(result.current.conversation).toBe(false)           // ended; no further re-arm
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.state).toBe('error')
    expect((request as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3)
  } finally { vi.useRealTimers() }
})

it('suppresses model text and audio when the app handles a spoken confirmation',async()=>{
 const {deps,audio}=makeDeps()
 const {fetchMock}=okFetch({...TURN_OK,transcript:'yes',reply:'An unverified model acknowledgment'})
 const onReply=vi.fn(()=>false as const)
 const {result}=renderHook(()=>useRosinaVoice({...deps,request:fetchMock,onReply}))
 await act(async()=>{await result.current.start()})
 await act(async()=>{result.current.stop()})
 await waitFor(()=>expect(onReply).toHaveBeenCalled())
 expect(result.current.state).toBe('idle')
 expect(result.current.reply).toBeNull()
 expect(result.current.actions).toEqual([])
 expect(audio.play).not.toHaveBeenCalled()
})
