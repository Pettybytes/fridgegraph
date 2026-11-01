/**
 * Tap-to-talk voice for Rosina — the state machine + transport, self-contained and injectable.
 * It never holds a key: the caller's in-memory bearer is sent to the same-origin voice-turn
 * server exactly like a Rosina text turn (the Meta/ElevenLabs keys stay server-side).
 *
 * Honest states (design.md §10): a transcript or level meter is shown ONLY while a real voice
 * state is active, and the transcript is only ever what the server returned. Two real network
 * phases back the required states: `/voice/transcribe` (transcribing) then `/voice/turn` with the
 * returned text (thinking → speaking). Voice never auto-confirms anything — `actions` are handed
 * back for the panel to render; a consequential action still needs the parent's explicit tap.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error'
export type VoiceErrorKind = 'mic-denied' | 'rate-limited' | 'sign-in' | 'server'
export type VoiceError = { kind: VoiceErrorKind; message: string }

export type VoiceModels = { asr: string | null; tts: string | null; voice: string | null; rosina: string | null } | null

/** Minimal shapes so tests can stub the platform. */
export type RecorderLike = { start(): void; stop(): void; state: string }
export type LevelMeter = { level(): number; stop(): void }
export type AudioLike = { play(): Promise<void> | void; pause(): void; currentTime: number; onended: (() => void) | null }

export type VoiceDeps = {
  /** Reads the CURRENT in-memory session bearer, never a captured one. */
  getAccessToken: () => string | null | undefined | Promise<string | null | undefined>
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
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m))
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
  const voiceRepliesRef = useRef(voiceReplies)
  voiceRepliesRef.current = voiceReplies

  const stopMeter = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    meterRef.current?.stop(); meterRef.current = null
    setLevel(0)
  }, [])

  const stopAudio = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; audioRef.current = null }
    setState((s) => (s === 'speaking' ? 'idle' : s))
  }, [])

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

  const runTurn = useCallback(async (clip: Blob) => {
    setState('transcribing')
    const tRes = await authed('/voice/transcribe', { method: 'POST', headers: { 'Content-Type': clip.type || 'audio/webm' }, body: clip })
    if (isVoiceError(tRes)) { setError(tRes); setState('error'); return }
    const tBody = (await tRes.json().catch(() => null)) as { text?: unknown } | null
    const text = typeof tBody?.text === 'string' ? tBody.text.trim() : ''
    if (!text) { setError(SERVER_ERROR); setState('error'); return }
    setTranscript(text) // only ever what the server returned

    setState('thinking')
    const uRes = await authed('/voice/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    if (isVoiceError(uRes)) { setError(uRes); setState('error'); return }
    const u = (await uRes.json().catch(() => null)) as { reply?: unknown; actions?: unknown; models?: VoiceModels; audioBase64?: unknown; mimeType?: unknown } | null
    if (!u || typeof u.reply !== 'string') { setError(SERVER_ERROR); setState('error'); return }
    setReply(u.reply)
    setActions(Array.isArray(u.actions) ? u.actions : [])
    setModels(u.models ?? null)

    if (voiceRepliesRef.current && typeof u.audioBase64 === 'string' && u.audioBase64 && typeof u.mimeType === 'string') {
      const audio = createAudio(`data:${u.mimeType};base64,${u.audioBase64}`)
      audioRef.current = audio
      audio.onended = () => { audioRef.current = null; setState('idle') }
      setState('speaking')
      try { await audio.play() } catch { setState('idle') }
    } else {
      setState('idle')
    }
  }, [authed, createAudio])

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

  const cancel = useCallback(() => {
    stopMeter(); stopAudio()
    if (recorderRef.current && recorderRef.current.state !== 'inactive') { try { recorderRef.current.stop() } catch { /* noop */ } }
    recorderRef.current = null
    setState('idle'); setError(null)
  }, [stopMeter, stopAudio])

  const toggleVoiceReplies = useCallback(() => setVoiceReplies((v) => !v), [])

  useEffect(() => () => { stopMeter(); if (audioRef.current) audioRef.current.pause() }, [stopMeter])

  return { state, transcript, reply, actions, models, error, level, voiceReplies, toggleVoiceReplies, start, stop, cancel, stopAudio }
}
