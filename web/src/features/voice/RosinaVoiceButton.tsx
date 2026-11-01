/**
 * Tap-to-talk voice button for Rosina — SELF-CONTAINED (does not touch RosinaPanel/rosina.css).
 * Mount it next to the panel's Send button:  <RosinaVoiceButton />
 *
 * Design freeze: existing tokens + fg primitives only, no new visual direction. Honesty: the
 * transcript and level meter appear only during a real voice state, and the transcript is only
 * ever what the server returned. Text input stays the always-available alternative — this button
 * is additive. Voice never auto-confirms: any `actions` are handed to the panel to render as
 * cards the parent still taps to confirm.
 */
import { useEffect } from 'react'
import { Mic, Square, Volume2, VolumeX, CircleStop } from 'lucide-react'
import { useSession } from '@/features/personas/Session'
import { StatusChip, InlineFeedback } from '@/components/fg/primitives'
import { useRosinaVoice, type VoiceDeps, type VoiceState } from './useRosinaVoice'
import './voice.css'

const STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Tap to talk to Rosina', listening: 'Listening… tap to send', transcribing: 'Transcribing…',
  thinking: 'Rosina is thinking…', speaking: 'Rosina is speaking', error: 'Voice error',
}

/** Presentational — bearer + platform injected, so it renders without a session in tests. */
export function VoicePanel({ getAccessToken, deps, onActions }: {
  getAccessToken: VoiceDeps['getAccessToken']
  deps?: Partial<Omit<VoiceDeps, 'getAccessToken'>>
  onActions?: (actions: unknown[]) => void
}) {
  const v = useRosinaVoice({ getAccessToken, ...deps })
  // Hand any returned actions to the panel to render as cards — never auto-confirmed here.
  useEffect(() => { if (v.reply && v.actions.length > 0) onActions?.(v.actions) }, [v.reply, v.actions, onActions])
  const busy = v.state === 'transcribing' || v.state === 'thinking'
  const micLabel = v.state === 'listening' ? 'Stop and send' : 'Start talking to Rosina'

  return (
    <div className="fg-voice" data-state={v.state}>
      {/* The one control: a labelled, keyboard-operable mic; hold-to-talk on touch. */}
      <button
        type="button"
        className="fg-iconbtn"
        aria-label={micLabel}
        aria-pressed={v.state === 'listening'}
        data-variant={v.state === 'listening' ? 'brand' : undefined}
        onClick={() => (v.state === 'listening' ? v.stop() : void v.start())}
        onTouchStart={(e) => { e.preventDefault(); if (v.state === 'idle' || v.state === 'error') void v.start() }}
        onTouchEnd={(e) => { e.preventDefault(); if (v.state === 'listening') v.stop() }}
        disabled={busy || v.state === 'speaking'}
      >
        {v.state === 'listening' ? <Square size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
      </button>

      {/* Live level meter — driven by the REAL mic input, shown only while listening. */}
      {v.state === 'listening' && (
        <span className="fg-voice-meter" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="fg-voice-bar" style={{ ['--h' as string]: `${Math.max(0.12, Math.min(1, v.level * (1 + i * 0.35)))}` }} />
          ))}
        </span>
      )}

      {busy && <StatusChip tone="brand" icon={false}>{STATE_LABEL[v.state]}</StatusChip>}

      {/* State changes are announced for assistive tech. */}
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

/** Connected mount — reads the caller's in-memory bearer from the session. One line for Codex. */
export function RosinaVoiceButton({ deps, onActions }: { deps?: Partial<Omit<VoiceDeps, 'getAccessToken'>>; onActions?: (actions: unknown[]) => void }) {
  const { getCurrentSession } = useSession()
  return <VoicePanel getAccessToken={() => getCurrentSession()?.accessToken ?? null} deps={deps} onActions={onActions} />
}
