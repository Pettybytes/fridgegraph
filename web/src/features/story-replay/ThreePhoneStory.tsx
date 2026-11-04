import { useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { RosinaAvatar } from '@/components/fg/RosinaAvatar'
import { JourneyPhone, OutcomePhone, TracePhone } from './phones'
import { REPLAY_DURATION_MS, captionAt } from './story'
import { REPLAY_NARRATION, speakerAt, type Narration } from './narration'
import { useReplayPlayback } from './useReplayPlayback'
import './story-replay.css'

export type ThreePhoneStoryProps = { narration?: Narration | null; initialAutoplay?: boolean }
type Pane = 'parent' | 'trace' | 'village'
const PANES: readonly { id: Pane; label: string }[] = [
  { id: 'parent', label: 'Parent' }, { id: 'trace', label: 'Under the hood' }, { id: 'village', label: 'Village' },
]

export function ThreePhoneStory({ narration = REPLAY_NARRATION }: ThreePhoneStoryProps) {
  const {sectionRef,audioRef,elapsed:seconds,playing:active,soundEnabled,ready,error,reducedMotion,play,pause,replay,toggleSound,audioEvents} = useReplayPlayback(REPLAY_DURATION_MS / 1000)
  const [selected, setSelected] = useState<Pane>('parent')
  const elapsed = seconds * 1000, duration = REPLAY_DURATION_MS
  const progress = Math.min(100, elapsed / duration * 100)
  const speaking = Boolean(narration) && soundEnabled && active && speakerAt(narration, elapsed) === 'rosina'
  const journeyElapsed = Math.min(Math.floor(elapsed / 200) * 200, duration)

  return <section className="sr" ref={sectionRef} aria-labelledby="sr-title" data-playing={active} data-reduced-motion={reducedMotion} data-loop-count={0}>
    <div className="sr-backdrop" aria-hidden="true" />
    <div className="sr-inner">
      <div className="sr-heading">
        <div>
          <p className="sr-eyebrow">Demo replay · fictional people</p>
          <h2 id="sr-title">One plan, three perspectives</h2>
          <p>Nora’s pickup replayed end to end: Kendra’s phone, the call chain under the hood, and the real Village map, narrated in Rosina’s own voice.</p>
        </div>
        <div className="sr-player" aria-label="Replay playback">
          <RosinaAvatar state={speaking ? 'speaking' : 'ready'} size={44} />
          <div className="sr-controls">
            <button type="button" onClick={active ? pause : elapsed >= duration ? replay : play} disabled={!ready}>{active ? 'Pause' : 'Play'}</button>
            <button type="button" onClick={replay} disabled={!ready}>Replay</button>
            <button type="button" onClick={toggleSound} disabled={!narration} aria-pressed={soundEnabled}>{soundEnabled ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}{narration ? (soundEnabled ? 'Sound on' : 'Tap to turn sound on') : 'Sound unavailable'}</button>
          </div>
        </div>
      </div>
      {!ready && !error && <p className="sr-audio-note" role="status">Loading narration fully before playback…</p>}
      {error && <p className="sr-audio-note" role="alert">{error}</p>}
      <div className="sr-progress" role="progressbar" aria-label="Replay progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div>
      <p className="sr-caption">{captionAt(elapsed)}</p>
      <div className="sr-perspectives" aria-label="Choose a phone">
        {PANES.map(pane => <button key={pane.id} type="button" aria-pressed={selected === pane.id} onClick={() => setSelected(pane.id)}>{pane.label}</button>)}
      </div>
      <div className="sr-grid">
        <figure className={`sr-view sr-view--parent${selected === 'parent' ? ' sr-mobile-active' : ''}`}>
          <div className="sr-card"><div className="sr-card-image" aria-hidden="true" /><JourneyPhone elapsed={journeyElapsed} /></div>
          <figcaption><strong>Parent</strong><span aria-hidden="true"> · </span>Kendra, Nora’s whole path</figcaption>
        </figure>
        <figure className={`sr-view sr-view--trace${selected === 'trace' ? ' sr-mobile-active' : ''}`}>
          <div className="sr-card"><div className="sr-card-image" aria-hidden="true" /><TracePhone elapsed={elapsed} /></div>
          <figcaption><strong>Under the hood</strong><span aria-hidden="true"> · </span>Muse to Rosina to MCP to Router</figcaption>
        </figure>
        <figure className={`sr-view sr-view--village${selected === 'village' ? ' sr-mobile-active' : ''}`}>
          <div className="sr-card"><div className="sr-card-image" aria-hidden="true" /><OutcomePhone elapsed={elapsed} /></div>
          <figcaption><strong>Village</strong><span aria-hidden="true"> · </span>Route, Activity, Mission Control</figcaption>
        </figure>
      </div>
      <audio ref={audioRef} src={(narration ?? REPLAY_NARRATION).src} preload="auto" muted={!soundEnabled || !narration} {...audioEvents} aria-label="Rosina’s narration" />
      <p className="sr-footnote">A replay of the demo flow with fictional people. The narration is Rosina’s real ElevenLabs voice, recorded once through the app’s own voice path; the Village map is the real OpenFreeMap-based map this app uses. The phones reconstruct the real steps of the journey. Loretta’s reply and Kendra’s confirmation are separate decisions, and no pickup is actually arranged.</p>
    </div>
  </section>
}
