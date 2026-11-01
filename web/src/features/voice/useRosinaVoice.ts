/**
 * Tap-to-talk voice for Rosina — the state machine + transport, self-contained and injectable.
 * It never holds a key: the caller's in-memory bearer is sent to the same-origin voice-turn
 * server exactly like a Rosina text turn (the Meta/ElevenLabs keys stay server-side).
 *
 * Truthful states (design.md §10): a transcript or level meter is shown ONLY while a real voice
 * state is active, and the transcript is only ever what the server returned. `/voice/turn` is ONE
 * buffered request (audio in → transcript + reply + audio out), so there is a single combined
 * `processing` state while waiting — never a faked transcribing→thinking on timers. `speaking`
 * is entered only once playback actually starts; if the browser rejects autoplay we surface a
 * `needs-play` state with a Play-reply control instead of claiming to speak.
 *
 * It does NOT re-invoke Rosina: `/voice/turn` already ran her turn, so the transcript and reply
 * are reported via callbacks for the panel to insert into the CURRENT conversation — never sent
 * back through the text handler (no duplicate turn). `actions` are exposed for the panel's cards;
 * voice never auto-confirms. On a persona/child change (`resetKey`) everything is torn down and
 * any in-flight or late result is discarded.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'needs-play' | 'error'
export type VoiceErrorKind = 'mic-denied' | 'rate-limited' | 'sign-in' | 'server'
export type VoiceError = { kind: VoiceErrorKind; message: string }
export type VoiceModels = { asr: string | null; tts: string | null; voice: string | null; rosina: string | null } | null

export type RecorderLike = { start(): void; stop(): void; state: string }
export type LevelMeter = { level(): number; stop(): void }
export type AudioLike = { play(): Promise<void> | void; pause(): void; currentTime: number; onended: (() => void) | null }

export type VoiceDeps = {
  /** Reads the CURRENT in-memory session bearer, never a captured one. */
  getAccessToken: () => string | null | undefined | Promise<string | null | undefined>
  /** Changing this (persona/child) tears everything down and discards late results. */
  resetKey?: unknown
  /** The server's transcript + reply are reported here to insert into the live conversation. */
  onTranscript?: (text: string) => void
  onReply?: (reply: string, actions: unknown[]) => void
  request?: typeof fetch
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createRecorder?: (stream: MediaStream, onData: (blob: Blob) => void) => RecorderLike
  createMeter?: (stream: MediaStream) => LevelMeter
  createAudio?: (url: string) => AudioLike
}

const ERRORS: Record<number, VoiceError> = {
  401: { kind: 'sign-in', message: 'Please sign in again to use voice.' },
  429: { kind: 'rate-limited', message: 'Rosina needs a moment — try again shortly.' },
}
const MIC_DENIED: VoiceError = { kind: 'mic-denied', message: 'Microphone access is blocked. Allow it for this site in your browser’s address-bar/site settings, then try again.' }
const SERVER_ERROR: VoiceError = { kind: 'server', message: "I couldn't do that just now. You can type your message instead." }
const isVoiceError = (x: Response | VoiceError): x is VoiceError => 'kind' in x && typeof (x as VoiceError).kind === 'string'

// ── Real platform defaults (replaced in tests) ──────────────────────────────
function defaultGetUserMedia(c: MediaStreamConstraints) { return navigator.mediaDevices.getUserMedia(c) }
function defaultRecorder(stream: MediaStream, onData: (b: Blob) => void): RecorderLike {
  // Choose a format the browser actually supports; send its real MIME + bytes and let the
  // backend convert. Never relabel one container as another.
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m))
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  rec.onstop = () => { onData(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); stream.getTracks().forEach((t) => t.stop()) }
  return { start: () => rec.start(), stop: () => rec.stop(), get state() { return rec.state } }
}
function defaultMeter(stream: MediaStream): LevelMeter {
  const Ctx: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  const src = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser(); analyser.fftSize = 512
  src.connect(analyser)
  const buf = new Uint8Array(analyser.frequencyBinCount)
  return {
    level() { analyser.getByteFrequencyData(buf); let sum = 0; for (const v of buf) sum += v * v; return Math.min(1, Math.sqrt(sum / buf.length) / 128) },
    stop() { src.disconnect(); void ctx.close() },
  }
}
function defaultAudio(url: string): AudioLike { return new Audio(url) as unknown as AudioLike }

export function useRosinaVoice(deps: VoiceDeps) {
  const request = deps.request ?? fetch
  const getUserMedia = deps.getUserMedia ?? defaultGetUserMedia
  const createRecorder = deps.createRecorder ?? defaultRecorder
  const createMeter = deps.createMeter ?? defaultMeter
  const createAudio = deps.createAudio ?? defaultAudio

  const [state, setState] = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState<string | null>(null)
  const [reply, setReply] = useState<string | null>(null)
  const [actions, setActions] = useState<unknown[]>([])
  const [models, setModels] = useState<VoiceModels>(null)
  const [error, setError] = useState<VoiceError | null>(null)
  const [level, setLevel] = useState(0)
  const [voiceReplies, setVoiceReplies] = useState(true)

  const recorderRef = useRef<RecorderLike | null>(null)
  const meterRef = useRef<LevelMeter | null>(null)
  const audioRef = useRef<AudioLike | null>(null)
  const rafRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const epochRef = useRef(0) // bumped on every teardown; late results from an old epoch are dropped
  const voiceRepliesRef = useRef(voiceReplies); voiceRepliesRef.current = voiceReplies
  const cbRef = useRef({ onTranscript: deps.onTranscript, onReply: deps.onReply }); cbRef.current = { onTranscript: deps.onTranscript, onReply: deps.onReply }

  const stopMeter = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    meterRef.current?.stop(); meterRef.current = null
    setLevel(0)
  }, [])

  const releaseAudio = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; audioRef.current = null }
  }, [])
  const stopAudio = useCallback(() => { releaseAudio(); setState((s) => (s === 'speaking' || s === 'needs-play' ? 'idle' : s)) }, [releaseAudio])

  /** Full teardown: stop recording + playback + mic, abort in-flight, and drop any late result. */
  const teardown = useCallback((reset: boolean) => {
    epochRef.current += 1
    abortRef.current?.abort(); abortRef.current = null
    stopMeter(); releaseAudio()
    if (recorderRef.current && recorderRef.current.state !== 'inactive') { try { recorderRef.current.stop() } catch { /* noop */ } }
    recorderRef.current = null
    if (reset) { setState('idle'); setTranscript(null); setReply(null); setActions([]); setModels(null); setError(null) }
  }, [stopMeter, releaseAudio])

  const authed = useCallback(async (path: string, init: RequestInit): Promise<Response | VoiceError> => {
    const token = await deps.getAccessToken()
    if (!token) return ERRORS[401]
    let res: Response
    try { res = await request(path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } }) }
    catch { return SERVER_ERROR }
    if (res.status === 401 || res.status === 429) return ERRORS[res.status]
    if (!res.ok) return SERVER_ERROR
    return res
  }, [deps, request])

  const playStored = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) { setState('idle'); return }
    setState('speaking')
    try { await audio.play() } catch { setState('needs-play') }
  }, [])

  const runTurn = useCallback(async (clip: Blob) => {
    const epoch = epochRef.current
    const controller = new AbortController(); abortRef.current = controller
    const stale = () => epochRef.current !== epoch
    setState('processing')
    // ONE buffered call: audio in → transcript + reply + speech out.
    const res = await authed('/voice/turn', { method: 'POST', headers: { 'Content-Type': clip.type || 'audio/webm' }, body: clip, signal: controller.signal })
    if (stale()) return
    if (isVoiceError(res)) { setError(res); setState('error'); return }
    const u = (await res.json().catch(() => null)) as { transcript?: unknown; reply?: unknown; actions?: unknown; models?: VoiceModels; audioBase64?: unknown; mimeType?: unknown } | null
    if (stale()) return
    if (!u || typeof u.transcript !== 'string' || !u.transcript.trim() || typeof u.reply !== 'string') { setError(SERVER_ERROR); setState('error'); return }

    const text = u.transcript.trim(), rep = u.reply
    const acts = Array.isArray(u.actions) ? u.actions : []
    setTranscript(text); setReply(rep); setActions(acts); setModels(u.models ?? null)
    cbRef.current.onTranscript?.(text)   // insert into the live conversation…
    cbRef.current.onReply?.(rep, acts)   // …no second Rosina turn, cards left for the panel

    if (voiceRepliesRef.current && typeof u.audioBase64 === 'string' && u.audioBase64 && typeof u.mimeType === 'string') {
      const audio = createAudio(`data:${u.mimeType};base64,${u.audioBase64}`)
      audioRef.current = audio
      audio.onended = () => { if (!stale()) { audioRef.current = null; setState('idle') } }
      await playStored()
    } else {
      setState('idle')
    }
  }, [authed, createAudio, playStored])

  const start = useCallback(async () => {
    if (state !== 'idle' && state !== 'error') return
    setError(null); setTranscript(null); setReply(null); setActions([])
    let stream: MediaStream
    try { stream = await getUserMedia({ audio: true }) }
    catch { setError(MIC_DENIED); setState('error'); return }
    meterRef.current = createMeter(stream)
    const tick = () => { if (meterRef.current) { setLevel(meterRef.current.level()); rafRef.current = requestAnimationFrame(tick) } }
    rafRef.current = requestAnimationFrame(tick)
    recorderRef.current = createRecorder(stream, (clip) => { recorderRef.current = null; void runTurn(clip) })
    recorderRef.current.start()
    setState('listening')
  }, [state, getUserMedia, createMeter, createRecorder, runTurn])

  const stop = useCallback(() => {
    if (state !== 'listening') return
    stopMeter()
    recorderRef.current?.stop() // onData → runTurn
  }, [state, stopMeter])

  const cancel = useCallback(() => teardown(true), [teardown])
  const playReply = useCallback(() => { void playStored() }, [playStored])
  const toggleVoiceReplies = useCallback(() => setVoiceReplies((v) => !v), [])

  // Persona/child change, or unmount: reset or tear down everything; discard any late result.
  useEffect(() => { return () => { teardown(true) } }, [deps.resetKey, teardown])

  return { state, transcript, reply, actions, models, error, level, voiceReplies, toggleVoiceReplies, start, stop, cancel, stopAudio, playReply }
}
