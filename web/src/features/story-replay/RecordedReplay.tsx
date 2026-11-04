import { useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { RosinaAvatar } from '@/components/fg/RosinaAvatar'
import { RECORDING } from './recording'
import { useReplayPlayback } from './useReplayPlayback'
import './story-replay.css'

const PANES = ['Parent', 'Under the hood', 'Village'] as const

export function RecordedReplay() {
  const {sectionRef:section, audioRef:audio, videoRefs:videos, elapsed, playing, soundEnabled, ready, error, reducedMotion, play, pause, replay, toggleSound, audioEvents} = useReplayPlayback(RECORDING.durationSeconds)
  const [selected, setSelected] = useState(0)
  const [videoError, setVideoError] = useState('')
  const caption = RECORDING.captions.find(cue => elapsed >= cue.start && elapsed < cue.end)?.text ?? ''
  const progress = Math.min(100, elapsed / RECORDING.durationSeconds * 100)
  return <section ref={section} className="sr sr-recorded" aria-labelledby="recorded-replay-title" data-playing={playing} data-reduced-motion={reducedMotion}>
    <div className="sr-backdrop" aria-hidden="true" />
    <div className="sr-inner">
      <div className="sr-heading">
        <div><h2 id="recorded-replay-title">One plan, three perspectives</h2><p>Recorded run of the real app · fictional people</p></div>
        <div className="sr-player" aria-label="Replay playback">
          <RosinaAvatar size={44} state={playing && soundEnabled && elapsed < RECORDING.audioEndSeconds ? 'speaking' : 'ready'} />
          <div className="sr-controls">
            <button type="button" disabled={!ready} onClick={playing ? pause : elapsed >= RECORDING.durationSeconds - 0.1 ? replay : play}>{playing ? 'Pause' : 'Play'}</button>
            <button type="button" onClick={() => { setVideoError(''); replay() }} disabled={!ready}>Replay</button>
            <button type="button" onClick={toggleSound} aria-pressed={soundEnabled}>{soundEnabled ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}{soundEnabled ? 'Sound on' : 'Tap to turn sound on'}</button>
          </div>
        </div>
      </div>
      <p className="sr-footnote">{RECORDING.disclosure}</p>
      {(error || videoError) && <p role="alert" className="sr-audio-note">{error || videoError}</p>}
      <p role="status" className="sr-recorded-status">{!ready && !error ? 'Loading narration fully before playback…' : ''}</p>
      <div className="sr-progress" role="progressbar" aria-label="Replay progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
      <p className="sr-caption">{caption}</p>
      <div className="sr-perspectives" aria-label="Choose a phone">{PANES.map((name, index) => <button key={name} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>{name}</button>)}</div>
      <div className="sr-grid">{RECORDING.tracks.map((track, index) => <figure key={track.src} className={`sr-view sr-view--${['parent', 'trace', 'village'][index]}${selected === index ? ' sr-mobile-active' : ''}`}>
        <div className="sr-card"><div className="sr-card-image" aria-hidden="true" /><div className="sr-phone sr-phone--recorded"><div className="sr-screen">
          <video ref={node => { videos.current[index] = node }} src={track.src} poster={track.poster} preload="auto" muted playsInline aria-label={`${PANES[index]} recorded footage`} onError={() => setVideoError('A recording could not load. Press Replay to retry.')} />
        </div></div></div><figcaption><strong>{PANES[index]}</strong><span aria-hidden="true"> · </span>{track.description}</figcaption>
      </figure>)}</div>
      <audio ref={audio} src={RECORDING.audioSrc} preload="auto" muted={!soundEnabled} {...audioEvents} aria-label="Rosina’s narration" />
      <details className="sr-footnote"><summary>About this recording and transcript</summary><p>{RECORDING.provenance}</p>{RECORDING.captions.map(cue => <p key={cue.start}>{cue.text}</p>)}</details>
    </div>
  </section>
}
