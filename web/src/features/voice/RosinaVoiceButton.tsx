/**
 * Tap-to-talk voice button for Rosina — SELF-CONTAINED (does not touch RosinaPanel/rosina.css).
 * Mount it next to the panel's Send button and wire it to the live conversation:
 *
 *   <RosinaVoiceButton
 *     onTranscript={(text) => appendUserMessage(text)}
 *     onReply={(reply, actions) => appendRosinaReply(reply, actions)}  // cards from `actions`
 *   />
 *
 * Design freeze: existing tokens + fg primitives only. Honesty (design.md §10): the transcript
 * and level meter appear only during a real voice state, and the transcript is only ever what the
 * server returned. `/voice/turn` is one buffered call, so a single "processing" state shows while
 * waiting — no faked transcribing→thinking. "Speaking" shows only once playback starts; if the
 * browser blocks autoplay, a visible "Play reply" button appears. Text input stays the
 * always-available alternative — this button is additive. Voice never auto-confirms; any actions
 * are handed up for the panel to render as cards the parent still taps to confirm. On a
 * persona/child change everything resets and late results are discarded.
 */
import { Mic, Square, Volume2, VolumeX, CircleStop, Play } from 'lucide-react'
import { useSession } from '@/features/personas/Session'
import { StatusChip, InlineFeedback } from '@/components/fg/primitives'
import { useRosinaVoice, type VoiceDeps, type VoiceState } from './useRosinaVoice'
import './voice.css'

const STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Tap to talk to Rosina', listening: 'Listening… tap to send', processing: 'Rosina is working…',
  speaking: 'Rosina is speaking', 'needs-play': 'Tap Play to hear Rosina’s reply', error: 'Voice error',
}

export type VoiceConversation = {
  onTranscript?: (text: string) => void
  onReply?: (reply: string, actions: unknown[]) => void
}

/** Presentational — bearer + resetKey + platform injected, so it renders without a session in tests. */
export function VoicePanel({ getAccessToken, resetKey, deps, onTranscript, onReply }: {
  getAccessToken: VoiceDeps['getAccessToken']
  resetKey?: unknown
  deps?: Partial<Omit<VoiceDeps, 'getAccessToken' | 'resetKey' | 'onTranscript' | 'onReply'>>
} & VoiceConversation) {
  const v = useRosinaVoice({ getAccessToken, resetKey, onTranscript, onReply, ...deps })
  const micLabel = v.state === 'listening' ? 'Stop and send' : 'Start talking to Rosina'

  return (
    <div className="fg-voice" data-state={v.state}>
      <button
        type="button"
        className="fg-iconbtn"
        aria-label={micLabel}
        aria-pressed={v.state === 'listening'}
        data-variant={v.state === 'listening' ? 'brand' : undefined}
        onClick={() => (v.state === 'listening' ? v.stop() : void v.start())}
        onTouchStart={(e) => { e.preventDefault(); if (v.state === 'idle' || v.state === 'error') void v.start() }}
        onTouchEnd={(e) => { e.preventDefault(); if (v.state === 'listening') v.stop() }}
        disabled={v.state === 'processing' || v.state === 'speaking'}
      >
        {v.state === 'listening' ? <Square size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
      </button>

      {/* Live level meter — REAL mic input, shown only while listening. */}
      {v.state === 'listening' && (
        <span className="fg-voice-meter" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="fg-voice-bar" style={{ ['--h' as string]: `${Math.max(0.12, Math.min(1, v.level * (1 + i * 0.35)))}` }} />
          ))}
        </span>
      )}

      {v.state === 'processing' && <StatusChip tone="brand" icon={false}>{STATE_LABEL.processing}</StatusChip>}

      {/* Autoplay blocked: offer a visible control rather than claiming to speak. */}
      {v.state === 'needs-play' && (
        <button type="button" className="fg-voice-stopaudio" onClick={v.playReply}><Play size={15} aria-hidden /> Play reply</button>
      )}

      <span className="fg-voice-live" role="status" aria-live="polite">{v.state === 'error' ? v.error?.message : STATE_LABEL[v.state]}</span>

      {/* Transcript + reply appear only once the server returned them. */}
      {v.transcript && <p className="fg-voice-transcript"><span className="fg-voice-you">You</span> {v.transcript}</p>}
      {v.reply && <p className="fg-voice-reply"><span className="fg-voice-her">Rosina</span> {v.reply}</p>}

      {v.state === 'speaking' && (
        <button type="button" className="fg-voice-stopaudio" onClick={v.stopAudio}><CircleStop size={15} aria-hidden /> Stop audio</button>
      )}

      {v.error && <InlineFeedback tone="error">{v.error.message}</InlineFeedback>}

      <div className="fg-voice-info">
        <button type="button" className="fg-voice-toggle" aria-pressed={v.voiceReplies} onClick={v.toggleVoiceReplies}>
          {v.voiceReplies ? <Volume2 size={14} aria-hidden /> : <VolumeX size={14} aria-hidden />} Voice replies {v.voiceReplies ? 'on' : 'off'}
        </button>
        <p className="fg-voice-credit">Rosina listens with Muse Voice Transcribe and thinks with Muse Spark; her voice is ElevenLabs.</p>
      </div>
    </div>
  )
}

/** Connected mount — the caller's in-memory bearer + a resetKey that changes on persona/child. */
export function RosinaVoiceButton({ onTranscript, onReply }: VoiceConversation = {}) {
  const { getCurrentSession, session } = useSession()
  const resetKey = `${session?.persona.personId ?? ''}:${session?.scope.childId ?? ''}`
  return <VoicePanel getAccessToken={() => getCurrentSession()?.accessToken ?? null} resetKey={resetKey} onTranscript={onTranscript} onReply={onReply} />
}
