/**
 * Rosina voice controls — SELF-CONTAINED (does not touch rosina.css). One shared controller drives
 * both this panel mic and the Today mic (see VoiceProvider); this component only renders a controller
 * and calls its methods — it never starts a second recording or fires a synthetic click.
 *
 * Interaction is identical on desktop and touch: TAP to start listening, TAP again to stop and send
 * (no touch-start/touch-end gesture that could clip a short tap into near-empty audio). A tap during
 * speech interrupts and starts a fresh listening turn. A persistent "Start/End conversation" control
 * runs the hands-free Listening→Processing→Speaking→Listening loop.
 *
 * Honesty (design.md §10): the level meter shows only while a live mic is listening; "speaking" shows
 * only once playback starts. If autoplay is blocked a "Play reply" control appears; if speech
 * GENERATION failed the text answer is kept and a speech-only retry is offered. Text input stays the
 * always-available alternative — voice is additive and never auto-confirms.
 */
import { Mic, Square, Volume2, VolumeX, CircleStop, Play, MessageSquareOff, RadioTower } from 'lucide-react'
import { useSession } from '@/features/personas/Session'
import { StatusChip, InlineFeedback } from '@/components/fg/primitives'
import { useRosinaVoice, type VoiceDeps, type VoiceState } from './useRosinaVoice'
import { useVoiceControllerOptional, useVoiceBinding } from './VoiceProvider'
import './voice.css'

const STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Tap to talk to Rosina', listening: 'Listening… tap to send', processing: 'Rosina is working…',
  speaking: 'Rosina is speaking', 'needs-play': 'Tap Play to hear Rosina’s reply',
  'audio-unavailable': 'Audio is unavailable — her written reply is below', error: 'Voice error',
}

export type VoiceController = ReturnType<typeof useRosinaVoice>

export type VoiceConversation = {
  onTranscript?: (text: string) => void
  onReply?: (reply: string, actions: unknown[]) => void
}

/** Presentational — renders a controller the caller owns (so Today + the panel share ONE). */
export function VoiceControls({ v }: { v: VoiceController }) {
  const listening = v.state === 'listening'
  const speakingish = v.state === 'speaking' || v.state === 'needs-play' || v.state === 'audio-unavailable'
  const micLabel = listening ? 'Stop and send' : speakingish ? 'Interrupt and talk' : 'Start talking to Rosina'

  return (
    <div className="fg-voice" data-state={v.state} data-conversation={v.conversation ? 'on' : undefined}>
      <button
        type="button"
        className="fg-iconbtn"
        aria-label={micLabel}
        aria-pressed={listening}
        data-variant={listening ? 'brand' : undefined}
        onClick={v.toggle}
        disabled={v.state === 'processing'}
      >
        {listening ? <Square size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
      </button>

      {/* Hands-free conversation loop — persistent control. */}
      <button
        type="button"
        className="fg-voice-convo"
        aria-pressed={v.conversation}
        onClick={() => (v.conversation ? v.endConversation() : v.startConversation())}
      >
        {v.conversation ? <><MessageSquareOff size={14} aria-hidden /> End conversation</> : <><RadioTower size={14} aria-hidden /> Start conversation</>}
      </button>

      {listening && (
        <span className="fg-voice-meter" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="fg-voice-bar" style={{ ['--h' as string]: `${Math.max(0.12, Math.min(1, v.level * (1 + i * 0.35)))}` }} />
          ))}
        </span>
      )}

      {v.state === 'processing' && <StatusChip tone="brand" icon={false}>{STATE_LABEL.processing}</StatusChip>}

      {v.state === 'needs-play' && (
        <button type="button" className="fg-voice-stopaudio" onClick={v.playReply}><Play size={15} aria-hidden /> Play reply</button>
      )}

      {v.state === 'audio-unavailable' && (
        <button type="button" className="fg-voice-stopaudio" onClick={() => void v.retrySpeak()}><Play size={15} aria-hidden /> Play reply</button>
      )}

      <span className="fg-voice-live" role="status" aria-live="polite">{v.state === 'error' ? v.error?.message : STATE_LABEL[v.state]}</span>

      {v.transcript && <p className="fg-voice-transcript"><span className="fg-voice-you">You</span> {v.transcript}</p>}
      {v.reply && <p className="fg-voice-reply"><span className="fg-voice-her">Rosina</span> {v.reply}</p>}

      {v.state === 'speaking' && (
        <button type="button" className="fg-voice-stopaudio" onClick={v.stopAudio}><CircleStop size={15} aria-hidden /> Stop audio</button>
      )}

      {v.error && <InlineFeedback tone="error">{v.error.message} You can type your message instead.</InlineFeedback>}

      <div className="fg-voice-info">
        <button type="button" className="fg-voice-toggle" aria-pressed={v.voiceReplies} onClick={v.toggleVoiceReplies}>
          {v.voiceReplies ? <Volume2 size={14} aria-hidden /> : <VolumeX size={14} aria-hidden />} Voice replies {v.voiceReplies ? 'on' : 'off'}
        </button>
        <p className="fg-voice-credit">Rosina listens with Muse Voice Transcribe and thinks with Muse Spark; her voice is ElevenLabs.</p>
      </div>
    </div>
  )
}

/** Self-instantiating wrapper — bearer + resetKey + platform injected, so it renders without a shared
 *  provider (used by standalone tests and anywhere a lone mic is wanted). */
export function VoicePanel({ getAccessToken, resetKey, getHistory, deps, onTranscript, onReply }: {
  getAccessToken: VoiceDeps['getAccessToken']
  resetKey?: unknown
  getHistory?: VoiceDeps['getHistory']
  deps?: Partial<Omit<VoiceDeps, 'getAccessToken' | 'resetKey' | 'onTranscript' | 'onReply' | 'getHistory'>>
} & VoiceConversation) {
  const v = useRosinaVoice({ getAccessToken, resetKey, getHistory, onTranscript, onReply, ...deps })
  return <VoiceControls v={v} />
}

/** Connected mount. Uses the shared controller (VoiceProvider) when present so the Today mic and the
 *  panel mic are ONE instance; falls back to a self-contained mic otherwise (standalone/tests). */
export function RosinaVoiceButton({ onTranscript, onReply, getHistory }: VoiceConversation & { getHistory?: VoiceDeps['getHistory'] } = {}) {
  const { getCurrentSession, session } = useSession()
  const shared = useVoiceControllerOptional()
  useVoiceBinding({ getHistory, onTranscript, onReply }) // no-op without a provider
  if (shared) return <VoiceControls v={shared} />
  const resetKey = `${session?.persona.personId ?? ''}:${session?.scope.childId ?? ''}:${session?.generation ?? ''}`
  return <VoicePanel getAccessToken={() => getCurrentSession()?.accessToken ?? null} resetKey={resetKey} getHistory={getHistory} onTranscript={onTranscript} onReply={onReply} />
}
