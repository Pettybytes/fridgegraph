/**
 * Rosina voice — ONE shared controller: the state machine + transport for both the Today mic and the
 * panel mic. It never holds a key: the caller's in-memory bearer is sent to the same-origin voice-turn
 * server exactly like a Rosina text turn (the Meta/ElevenLabs keys stay server-side).
 *
 * Truthful states (design.md §10): "listening" means a live microphone; "speaking" appears only once
 * playback actually starts. `/voice/turn` is ONE buffered request (audio in → transcript + reply +
 * audio out), so there is a single `processing` state while waiting — never a faked transcribing→
 * thinking on timers. If the browser blocks autoplay we surface `needs-play`; if speech GENERATION
 * failed but the answer is good we surface `audio-unavailable` (the text answer is kept, a speech-only
 * retry re-synthesizes WITHOUT re-running Rosina).
 *
 * It does NOT re-invoke Rosina: `/voice/turn` already ran her turn, so the transcript and reply are
 * reported via callbacks for the panel to insert into the CURRENT conversation — never sent back
 * through the text handler (no duplicate turn). Voice turns carry the SAME bounded history as text
 * turns (`getHistory`), scoped to the caller/child/session generation via `resetKey`: changing it
 * tears everything down and discards any in-flight or late result.
 *
 * Conversation mode runs Listening → Processing → Speaking → Listening: real end-of-speech detection
 * (silence after speech) plus a bounded recording cap, the mic paused during playback (so Rosina never
 * transcribes herself), and a re-arm ONLY after playback actually completes and only while the
 * conversation is still active. A tap during speech interrupts and starts a fresh listening turn.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'needs-play' | 'audio-unavailable' | 'error'
export type VoiceErrorKind =
  | 'mic-denied' | 'mic-unavailable' | 'unsupported'
  | 'no-speech' | 'transcribe' | 'model' | 'mcp' | 'tts'
  | 'rate-limited' | 'sign-in' | 'server'
export type VoiceError = { kind: VoiceErrorKind; message: string }
export type VoiceModels = { asr: string | null; tts: string | null; voice: string | null; rosina: string | null } | null
export type VoiceTimings = { asrMs?: number; rosinaMs?: number; ttsMs?: number; serverTotalMs?: number; speechEndToReplyMs?: number; speechEndToAudioMs?: number }
export type HistoryMessage = { role: 'user' | 'assistant'; content: string }

export type RecorderLike = { start(): void; stop(): void; state: string }
export type LevelMeter = { level(): number; stop(): void }
export type AudioLike = { play(): Promise<void> | void; pause(): void; currentTime: number; onended: (() => void) | null }

export type VadConfig = { speechThreshold: number; silenceMs: number; minMs: number; maxMs: number }
const DEFAULT_VAD: VadConfig = { speechThreshold: 0.08, silenceMs: 1200, minMs: 500, maxMs: 15000 }

export type VoiceDeps = {
  /** Reads the CURRENT in-memory session bearer, never a captured one. */
  getAccessToken: () => string | null | undefined | Promise<string | null | undefined>
  /** Changing this (persona/child/generation) tears everything down and discards late results. */
  resetKey?: unknown
  /** The bounded conversation history to send with each turn (same thread as text turns). */
  getHistory?: () => HistoryMessage[]
  /** The server's transcript + reply are reported here to insert into the live conversation. */
  onTranscript?: (text: string) => void
  onReply?: (reply: string, actions: unknown[]) => void
  request?: typeof fetch
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createRecorder?: (stream: MediaStream, onData: (blob: Blob) => void) => RecorderLike
  createMeter?: (stream: MediaStream) => LevelMeter
  createAudio?: (url: string) => AudioLike
  vad?: Partial<VadConfig>
  now?: () => number
}

const ERRORS: Record<number, VoiceError> = {
  401: { kind: 'sign-in', message: 'Please sign in again to use voice.' },
  429: { kind: 'rate-limited', message: 'Rosina needs a moment. Try again shortly.' },
}
// Server error codes → calm, specific copy. Each failure class is distinct so the UI can say what
// actually went wrong without leaking internals.
const CODE_ERRORS: Record<string, VoiceError> = {
  ASR_UNAVAILABLE: { kind: 'transcribe', message: "I couldn't make out the audio just now. You can type instead." },
  TRANSCRIPT_EMPTY: { kind: 'no-speech', message: "I didn't catch anything. Try again a little closer to the mic." },
  ROSINA_UNAVAILABLE: { kind: 'model', message: "I couldn't think that through just now. You can type instead." },
  MCP_UNAVAILABLE: { kind: 'mcp', message: "I couldn't reach your information just now. You can type instead." },
}
const MIC_DENIED: VoiceError = { kind: 'mic-denied', message: 'Microphone access is blocked. Allow it for this site in your browser’s settings, then try again.' }
const MIC_UNAVAILABLE: VoiceError = { kind: 'mic-unavailable', message: 'No microphone is available. You can type your message instead.' }
const UNSUPPORTED: VoiceError = { kind: 'unsupported', message: "This browser doesn't support voice capture. You can type instead." }
const SERVER_ERROR: VoiceError = { kind: 'server', message: "I couldn't do that just now. You can type your message instead." }

// ── Real platform defaults (replaced in tests) ──────────────────────────────
function defaultGetUserMedia(c: MediaStreamConstraints) { return navigator.mediaDevices.getUserMedia(c) }
function defaultRecorder(stream: MediaStream, onData: (b: Blob) => void): RecorderLike {
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

// Bound the history header by ENCODED UTF-8 BYTES, not characters, so a multilingual history (CJK /
// emoji are 3–4 bytes per char) can never exceed request-header limits. ~4KB of content → ~5.5KB
// base64, comfortably under the 8–16KB a server accepts.
const MAX_HISTORY_BYTES = 4096
const MAX_MESSAGE_BYTES = 1500

/** Last ≤8 messages (most recent kept), each clamped and the whole bounded by UTF-8 bytes, base64(JSON).
 *  Keeps the audio body as the request body while still giving the turn its conversational memory. */
export function encodeHistoryHeader(history: HistoryMessage[]): string | null {
  if (!history.length) return null
  const enc = new TextEncoder()
  const bytesOf = (s: string) => enc.encode(s).length
  const bounded: HistoryMessage[] = []
  let total = 0
  for (let i = history.length - 1; i >= 0 && bounded.length < 8; i -= 1) {
    const role = history[i].role === 'assistant' ? 'assistant' as const : 'user' as const
    let content = String(history[i].content ?? '')
    while (content.length && bytesOf(content) > MAX_MESSAGE_BYTES) content = content.slice(0, -1) // clamp by bytes
    const cost = bytesOf(content) + bytesOf(role) + 24 // + per-entry JSON overhead
    if (total + cost > MAX_HISTORY_BYTES) break
    bounded.unshift({ role, content })
    total += cost
  }
  if (!bounded.length) return null
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(bounded)))) } catch { return null }
}

export function useRosinaVoice(deps: VoiceDeps) {
  const request = deps.request ?? fetch
  const getUserMedia = deps.getUserMedia ?? defaultGetUserMedia
  const createRecorder = deps.createRecorder ?? defaultRecorder
  const createMeter = deps.createMeter ?? defaultMeter
  const createAudio = deps.createAudio ?? defaultAudio
  const now = deps.now ?? (() => Date.now())
  const vad: VadConfig = { ...DEFAULT_VAD, ...deps.vad }

  const [state, setState] = useState<VoiceState>('idle')
  const [conversation, setConversation] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [reply, setReply] = useState<string | null>(null)
  const [actions, setActions] = useState<unknown[]>([])
  const [models, setModels] = useState<VoiceModels>(null)
  const [timings, setTimings] = useState<VoiceTimings | null>(null)
  const [error, setError] = useState<VoiceError | null>(null)
  const [level, setLevel] = useState(0)
  const [voiceReplies, setVoiceReplies] = useState(true)

  const recorderRef = useRef<RecorderLike | null>(null)
  const meterRef = useRef<LevelMeter | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<AudioLike | null>(null)
  const rafRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const epochRef = useRef(0) // bumped on every teardown; late results from an old epoch are dropped
  const conversationRef = useRef(false); conversationRef.current = conversation
  const voiceRepliesRef = useRef(voiceReplies); voiceRepliesRef.current = voiceReplies
  const replyRef = useRef<string | null>(null)
  const speechEndAtRef = useRef(0)
  const cbRef = useRef({ onTranscript: deps.onTranscript, onReply: deps.onReply, getHistory: deps.getHistory })
  cbRef.current = { onTranscript: deps.onTranscript, onReply: deps.onReply, getHistory: deps.getHistory }
  // VAD bookkeeping for the active listening turn.
  const sawSpeechRef = useRef(false)
  const startedAtRef = useRef(0)
  const lastLoudAtRef = useRef(0)
  const stoppingRef = useRef(false)
  const autoStopRef = useRef(false) // true when VAD/duration-cap stopped the turn, false for a manual tap
  const acquiringRef = useRef(false) // true only while getUserMedia is pending — single-flight guard
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // timer-independent recording cap
  // Conversation resilience: one failed turn re-arms after a short pause instead of killing the
  // conversation; only consecutive failures (or a terminal error kind) end it.
  const consecutiveFailsRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCapTimer = useCallback(() => { if (capTimerRef.current != null) { clearTimeout(capTimerRef.current); capTimerRef.current = null } }, [])
  const clearRetryTimer = useCallback(() => { if (retryTimerRef.current != null) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null } }, [])
  const stopMeter = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    clearCapTimer()
    meterRef.current?.stop(); meterRef.current = null
    setLevel(0)
  }, [clearCapTimer])

  const releaseStream = useCallback(() => {
    if (streamRef.current) { try { streamRef.current.getTracks().forEach((t) => t.stop()) } catch { /* noop */ } streamRef.current = null }
  }, [])
  const releaseAudio = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; audioRef.current = null }
  }, [])

  /** Full teardown: stop recording + playback + mic, abort in-flight, and drop any late result. */
  const teardown = useCallback((reset: boolean) => {
    epochRef.current += 1
    stoppingRef.current = false
    clearRetryTimer()
    consecutiveFailsRef.current = 0
    abortRef.current?.abort(); abortRef.current = null
    stopMeter(); releaseAudio()
    if (recorderRef.current && recorderRef.current.state !== 'inactive') { try { recorderRef.current.stop() } catch { /* noop */ } }
    recorderRef.current = null
    releaseStream()
    if (reset) {
      setConversation(false)
      setState('idle'); setTranscript(null); setReply(null); replyRef.current = null; setActions([]); setModels(null); setError(null); setTimings(null)
    }
  }, [stopMeter, releaseAudio, releaseStream, clearRetryTimer])

  const authed = useCallback(async (path: string, init: RequestInit): Promise<{ res: Response } | { err: VoiceError }> => {
    const token = await deps.getAccessToken()
    if (!token) return { err: ERRORS[401] }
    let res: Response
    try { res = await request(path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } }) }
    catch { return { err: SERVER_ERROR } }
    if (res.status === 401 || res.status === 429) return { err: ERRORS[res.status] }
    if (!res.ok) {
      const code = await res.clone().json().then((b) => (b && typeof b.error === 'string' ? b.error : '')).catch(() => '')
      return { err: CODE_ERRORS[code] ?? SERVER_ERROR }
    }
    return { res }
  }, [deps, request])

  const playStored = useCallback(async (epoch: number) => {
    const audio = audioRef.current
    if (!audio) { if (epochRef.current === epoch) setState('idle'); return }
    try {
      await audio.play()
      if (epochRef.current !== epoch) return        // torn down while play() was pending
      setState('speaking')                           // "Speaking" only once playback ACTUALLY started
      if (speechEndAtRef.current) setTimings((t) => ({ ...(t ?? {}), speechEndToAudioMs: now() - speechEndAtRef.current }))
    } catch {
      if (epochRef.current !== epoch) return          // epoch check on rejection too
      setState('needs-play')
    }
  }, [now])

  // After playback completes: re-arm ONLY while conversation mode is still active (and not torn down).
  const armNext = useRef<() => void>(() => {})
  const onPlaybackEnded = useCallback((epoch: number) => {
    if (epochRef.current !== epoch) return
    audioRef.current = null
    if (conversationRef.current) armNext.current()
    else setState('idle')
  }, [])

  /** A failed turn in conversation mode re-arms after a short pause (longer when rate limited)
   * instead of ending the conversation; terminal kinds and a third consecutive failure stop it.
   * The error stays visible until the next listening turn clears it. */
  const failTurn = useCallback((err: VoiceError) => {
    setError(err)
    setState('error')
    const terminal = err.kind === 'sign-in' || err.kind === 'mic-denied' || err.kind === 'mic-unavailable' || err.kind === 'unsupported'
    if (!conversationRef.current) { consecutiveFailsRef.current = 0; return }
    if (terminal) { consecutiveFailsRef.current = 0; conversationRef.current = false; setConversation(false); return }
    consecutiveFailsRef.current += 1
    if (consecutiveFailsRef.current >= 3) { conversationRef.current = false; setConversation(false); return }
    const epoch = epochRef.current
    clearRetryTimer()
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      if (epochRef.current !== epoch || !conversationRef.current) return
      armNext.current()
    }, err.kind === 'rate-limited' ? 4000 : 1500)
  }, [clearRetryTimer])

  const runTurn = useCallback(async (clip: Blob) => {
    const epoch = epochRef.current
    const controller = new AbortController(); abortRef.current = controller
    const stale = () => epochRef.current !== epoch
    setState('processing')
    const historyHeader = encodeHistoryHeader(cbRef.current.getHistory?.() ?? [])
    const headers: Record<string, string> = { 'Content-Type': clip.type || 'audio/webm' }
    if (historyHeader) headers['X-Rosina-History'] = historyHeader
    const out = await authed('/voice/turn', { method: 'POST', headers, body: clip, signal: controller.signal })
    if (stale()) return
    if ('err' in out) { failTurn(out.err); return }
    const u = (await out.res.json().catch(() => null)) as
      | { transcript?: unknown; reply?: unknown; actions?: unknown; models?: VoiceModels; audioBase64?: unknown; mimeType?: unknown; ttsError?: unknown; timings?: VoiceTimings } | null
    if (stale()) return
    if (!u || typeof u.transcript !== 'string' || !u.transcript.trim() || typeof u.reply !== 'string') { failTurn(SERVER_ERROR); return }

    consecutiveFailsRef.current = 0
    const text = u.transcript.trim(), rep = u.reply
    const acts = Array.isArray(u.actions) ? u.actions : []
    setTranscript(text); setReply(rep); replyRef.current = rep; setActions(acts); setModels(u.models ?? null)
    const serverTimings = (u.timings && typeof u.timings === 'object') ? u.timings : {}
    setTimings({ ...serverTimings, speechEndToReplyMs: speechEndAtRef.current ? now() - speechEndAtRef.current : undefined })
    cbRef.current.onTranscript?.(text)   // insert into the live conversation…
    cbRef.current.onReply?.(rep, acts)   // …no second Rosina turn, cards left for the panel

    if (!voiceRepliesRef.current) { setState('idle'); if (conversationRef.current) armNext.current(); return }
    if (typeof u.audioBase64 === 'string' && u.audioBase64 && typeof u.mimeType === 'string') {
      const audio = createAudio(`data:${u.mimeType};base64,${u.audioBase64}`)
      audioRef.current = audio
      audio.onended = () => onPlaybackEnded(epoch)
      await playStored(epoch)
    } else {
      // Speech generation failed but the answer is good: keep the text, say audio is unavailable, and
      // offer a speech-only retry. Do NOT auto re-arm (no playback completed).
      setState('audio-unavailable')
    }
  }, [authed, createAudio, playStored, onPlaybackEnded, now, failTurn])

  // Finish the current listening turn: send the clip only if real speech was captured; otherwise do
  // not send silence (re-arm in conversation mode, else go idle).
  const finishTurn = useCallback((clip: Blob, epoch: number) => {
    if (epochRef.current !== epoch) return // the turn was torn down; drop the clip, never send it
    recorderRef.current = null
    stopMeter(); releaseStream()
    // speechEndAt was stamped at the moment end-of-speech was DECIDED (VAD silence / cap / manual tap),
    // so the measured interval includes recorder finalization + transport, not just the network.
    // A manual "stop and send" always sends. An AUTO stop (VAD silence or the duration cap) with no
    // speech detected is silence — never sent; re-arm or go idle instead.
    if (autoStopRef.current && !sawSpeechRef.current) { if (conversationRef.current) armNext.current(); else setState('idle'); return }
    void runTurn(clip)
  }, [stopMeter, releaseStream, runTurn])

  const beginListening = useCallback(async () => {
    if (acquiringRef.current) return // single-flight: a stream is already being acquired (rapid taps)
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      if (deps.getUserMedia == null) { setError(UNSUPPORTED); setState('error'); return }
    }
    // Never overwrite an active recorder/stream without releasing it first.
    if (recorderRef.current && recorderRef.current.state !== 'inactive') { try { recorderRef.current.stop() } catch { /* noop */ } }
    recorderRef.current = null
    stopMeter(); releaseStream()
    const epoch = epochRef.current
    acquiringRef.current = true
    let stream: MediaStream
    try { stream = await getUserMedia({ audio: true }) }
    catch (e) {
      acquiringRef.current = false
      const name = (e as { name?: string } | null)?.name
      setError(name === 'NotFoundError' || name === 'OverconstrainedError' ? MIC_UNAVAILABLE : name === 'NotSupportedError' ? UNSUPPORTED : MIC_DENIED)
      setState('error'); return
    }
    acquiringRef.current = false
    // If we were torn down (cancel / persona change / tab hidden) while permission was pending, release.
    if (epochRef.current !== epoch) { stream.getTracks().forEach((t) => t.stop()); return }
    streamRef.current = stream
    sawSpeechRef.current = false; startedAtRef.current = now(); lastLoudAtRef.current = now(); stoppingRef.current = false
    meterRef.current = createMeter(stream)
    const tick = () => {
      if (!meterRef.current || stoppingRef.current) return
      const lvl = meterRef.current.level()
      setLevel(lvl)
      const t = now()
      if (lvl >= vad.speechThreshold) { sawSpeechRef.current = true; lastLoudAtRef.current = t }
      const elapsed = t - startedAtRef.current
      const silentFor = t - lastLoudAtRef.current
      // Real end-of-speech: speech seen, then a bounded silence. (The hard cap is a timer, below.)
      if (sawSpeechRef.current && silentFor >= vad.silenceMs && elapsed >= vad.minMs) {
        stoppingRef.current = true; autoStopRef.current = true; speechEndAtRef.current = now()
        recorderRef.current?.stop() // → finishTurn
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    recorderRef.current = createRecorder(stream, (clip) => finishTurn(clip, epoch))
    recorderRef.current.start()
    setState('listening')
    rafRef.current = requestAnimationFrame(tick)
    // Recording cap on a TIMER, not an animation frame — rAF is suspended in a background tab, so a
    // rAF-based cap could let a recording run unbounded; setTimeout still fires.
    clearCapTimer()
    capTimerRef.current = setTimeout(() => {
      if (epochRef.current !== epoch || stoppingRef.current) return
      stoppingRef.current = true; autoStopRef.current = true; speechEndAtRef.current = now()
      recorderRef.current?.stop()
    }, vad.maxMs)
  }, [deps.getUserMedia, getUserMedia, createMeter, createRecorder, finishTurn, now, vad, stopMeter, releaseStream, clearCapTimer])

  armNext.current = () => { void beginListening() }

  // ── public controls ────────────────────────────────────────────────────────

  /** One tap: start a single listening turn (idempotent while already active). */
  const start = useCallback(async () => {
    if (state === 'listening' || state === 'processing') return
    if (state === 'speaking') return // use interrupt() to barge in
    await beginListening()
  }, [state, beginListening])

  /** Tap again: stop and send the current turn. */
  const stop = useCallback(() => {
    if (state !== 'listening') return
    stoppingRef.current = true; autoStopRef.current = false // manual send
    speechEndAtRef.current = now() // end-of-speech is the tap; finalization + transport are measured after
    stopMeter()
    recorderRef.current?.stop() // → finishTurn
  }, [state, stopMeter, now])

  /** Tap the primary control: start/stop in a single turn, or interrupt speech to talk again. */
  const toggle = useCallback(() => {
    if (state === 'listening') stop()
    else if (state === 'speaking' || state === 'needs-play' || state === 'audio-unavailable') { releaseAudio(); void beginListening() }
    else void start()
  }, [state, stop, start, beginListening, releaseAudio])

  const startConversation = useCallback(() => {
    setConversation(true); conversationRef.current = true
    consecutiveFailsRef.current = 0
    clearRetryTimer()
    // One explicit transition, by current state:
    //  - listening: ADOPT the recording already in flight (do not start a second one).
    //  - processing: a turn is mid-flight; the post-turn re-arm will start listening (conversation now on).
    //  - speaking / needs-play / audio-unavailable: interrupt playback into a fresh listening turn.
    //  - idle / error: begin listening.
    if (state === 'listening' || state === 'processing') return
    if (state === 'speaking' || state === 'needs-play' || state === 'audio-unavailable') releaseAudio()
    void beginListening()
  }, [state, beginListening, releaseAudio, clearRetryTimer])
  const endConversation = useCallback(() => { teardown(true) }, [teardown])

  const stopAudio = useCallback(() => {
    releaseAudio()
    if (conversationRef.current) armNext.current() // keep the conversation going
    else setState('idle')
  }, [releaseAudio])

  /** Speech-only retry after a TTS failure — re-synthesize the SAME reply; never re-runs Rosina. */
  const retrySpeak = useCallback(async () => {
    const text = replyRef.current
    if (!text) return
    const epoch = epochRef.current
    const out = await authed('/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    if (epochRef.current !== epoch) return
    if ('err' in out) { setState('audio-unavailable'); return }
    const u = (await out.res.json().catch(() => null)) as { audioBase64?: unknown; mimeType?: unknown } | null
    if (epochRef.current !== epoch) return
    if (!u || typeof u.audioBase64 !== 'string' || !u.audioBase64 || typeof u.mimeType !== 'string') { setState('audio-unavailable'); return }
    const audio = createAudio(`data:${u.mimeType};base64,${u.audioBase64}`)
    audioRef.current = audio
    audio.onended = () => onPlaybackEnded(epoch)
    await playStored(epoch)
  }, [authed, createAudio, playStored, onPlaybackEnded])

  const cancel = useCallback(() => teardown(true), [teardown])
  const playReply = useCallback(() => { void playStored(epochRef.current) }, [playStored])
  const toggleVoiceReplies = useCallback(() => setVoiceReplies((v) => !v), [])

  // Persona/child/generation change, or unmount: reset or tear down everything; discard any late result.
  useEffect(() => { return () => { teardown(true) } }, [deps.resetKey, teardown])

  // Tab hidden / navigating away: stop capture + playback, cancel pending work, discard late results.
  // Deliberately NO automatic restart when the tab returns — the user re-initiates.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onHide = () => { if (document.visibilityState === 'hidden') teardown(true) }
    const onPageHide = () => teardown(true)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onPageHide) }
  }, [teardown])

  return {
    state, conversation, transcript, reply, actions, models, timings, error, level, voiceReplies,
    toggleVoiceReplies, start, stop, toggle, startConversation, endConversation, cancel, stopAudio, playReply, retrySpeak,
  }
}
