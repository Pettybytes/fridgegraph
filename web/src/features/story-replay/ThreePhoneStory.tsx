import { useCallback, useEffect, useRef, useState } from 'react'
import { RosinaAvatar } from '@/components/fg/RosinaAvatar'
import { JourneyPhone, OutcomePhone, TracePhone } from './phones'
import { REPLAY_DURATION_MS, captionAt } from './story'
import { REPLAY_NARRATION, speakerAt, type Narration } from './narration'
import './story-replay.css'

export type ThreePhoneStoryProps = { narration?: Narration | null; initialAutoplay?: boolean }
type Pane = 'parent' | 'trace' | 'village'
const PANES: readonly { id: Pane; label: string }[] = [
  { id: 'parent', label: 'Parent' }, { id: 'trace', label: 'Under the hood' }, { id: 'village', label: 'Village' },
]
const reducedPreference = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function ThreePhoneStory({ narration = REPLAY_NARRATION, initialAutoplay = true }: ThreePhoneStoryProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const unlockedRef = useRef(false)
  const soundRef = useRef(false)
  const elapsedRef = useRef(0)
  const frameRef = useRef(0)
  const previousFrameRef = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState(() => reducedPreference() ? REPLAY_DURATION_MS : 0)
  const [playing, setPlaying] = useState(() => initialAutoplay && !reducedPreference())
  const [manualPause, setManualPause] = useState(false)
  const [visible, setVisible] = useState(true)
  const [tabVisible, setTabVisible] = useState(!document.hidden)
  const [selected, setSelected] = useState<Pane>('parent')
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [loopsCompleted, setLoopsCompleted] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(reducedPreference)
  const duration = REPLAY_DURATION_MS

  useEffect(() => { elapsedRef.current = elapsed }, [])

  useEffect(() => {
    const query = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    if (!query) return
    const change = () => {
      setReducedMotion(query.matches)
      if (query.matches) { setPlaying(false); setManualPause(true); elapsedRef.current = duration; setElapsed(duration) }
    }
    query.addEventListener?.('change', change)
    return () => query.removeEventListener?.('change', change)
  }, [duration])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false), { threshold: 0.1 })
    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const change = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])

  const active = playing && !manualPause && visible && tabVisible && elapsed < duration
  useEffect(() => {
    if (!active) { previousFrameRef.current = null; return }
    const tick = (now: number) => {
      if (previousFrameRef.current !== null) {
        const next = elapsedRef.current + now - previousFrameRef.current
        if (next >= duration) {
          const audio = audioRef.current
          if (audio) {
            audio.currentTime = 0
            if (soundRef.current) {
              try { void audio.play()?.catch(() => undefined) } catch { /* the toggle surfaces real refusals */ }
            } else if (!audio.paused) audio.pause()
          }
          if (reducedMotion) { elapsedRef.current = duration; setElapsed(duration); setPlaying(false); return }
          elapsedRef.current = next % duration
          setLoopsCompleted(count => count + 1)
        } else elapsedRef.current = next
        setElapsed(elapsedRef.current)
      }
      previousFrameRef.current = now
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frameRef.current); previousFrameRef.current = null }
  }, [active, duration, reducedMotion])

  // The one audio element follows the master clock by transitions only: it is
  // seeked and started once when playback (re)starts, then left to play untouched
  // so render load can never force audible mid-track seeks. Outside the narration
  // window it is paused; the loop wrap in the tick rewinds and restarts it.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !narration) return
    const within = elapsedRef.current < narration.durationMs
    if (!soundEnabled || !active || !within) { if (!audio.paused) audio.pause(); return }
    if (audio.paused) {
      audio.currentTime = elapsedRef.current / 1000
      // Only a real autoplay refusal flips the visible fallback; an interrupted
      // play() (AbortError from a pause) retries on the next clock tick.
      try { void audio.play()?.catch(error => { if ((error as Error)?.name !== 'AbortError') { setSoundEnabled(false); setAudioBlocked(true) } }) }
      catch { setSoundEnabled(false); setAudioBlocked(true) }
    }
  }, [active, narration, soundEnabled])
  useEffect(() => { soundRef.current = soundEnabled }, [soundEnabled])

  // Unlock playback on the first user gesture anywhere in the section, so the
  // later Unmute press always has an unlocked element to work with.
  const unlock = useCallback(() => {
    const audio = audioRef.current
    if (unlockedRef.current || !audio || !narration) return
    unlockedRef.current = true
    audio.muted = true
    const attempt = audio.play()
    if (attempt?.then) attempt.then(() => {
      // If the same gesture already turned sound on, leave playback running.
      if (!soundRef.current) { audio.pause(); audio.currentTime = 0 }
      audio.muted = false
    }).catch(() => { audio.muted = false })
    else audio.muted = false
  }, [narration])

  const pause = useCallback(() => { setPlaying(false); setManualPause(true); audioRef.current?.pause() }, [])
  const play = useCallback(() => {
    if (elapsedRef.current >= duration) { elapsedRef.current = 0; setElapsed(0); setLoopsCompleted(0) }
    setManualPause(false); setPlaying(true)
  }, [duration])
  const replay = useCallback(() => {
    elapsedRef.current = 0; setElapsed(0); setLoopsCompleted(0)
    const audio = audioRef.current
    if (audio) {
      audio.currentTime = 0
      if (soundRef.current) {
        try { void audio.play()?.catch(error => { if ((error as Error)?.name !== 'AbortError') { setSoundEnabled(false); setAudioBlocked(true) } }) }
        catch { setSoundEnabled(false); setAudioBlocked(true) }
      } else audio.pause()
    }
    setManualPause(false); setPlaying(true)
  }, [])
  const toggleSound = useCallback(() => {
    if (!narration) return
    const audio = audioRef.current
    if (soundEnabled) { audio?.pause(); setSoundEnabled(false); return }
    setAudioBlocked(false)
    setSoundEnabled(true)
    if (audio && elapsedRef.current < narration.durationMs) {
      audio.currentTime = elapsedRef.current / 1000
      try { void audio.play()?.catch(error => { if ((error as Error)?.name !== 'AbortError') { setSoundEnabled(false); setAudioBlocked(true) } }) }
      catch { setSoundEnabled(false); setAudioBlocked(true) }
    }
  }, [narration, soundEnabled])

  const progress = Math.min(100, elapsed / duration * 100)
  const speaking = Boolean(narration) && soundEnabled && active && speakerAt(narration, elapsed) === 'rosina'
  const journeyElapsed = Math.min(Math.floor(elapsed / 200) * 200, duration)

  return <section className="sr" ref={sectionRef} aria-labelledby="sr-title" data-playing={active} data-reduced-motion={reducedMotion} data-loop-count={loopsCompleted} onPointerDown={unlock}>
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
            <button type="button" onClick={active ? pause : play}>{active ? 'Pause' : 'Play'}</button>
            <button type="button" onClick={replay}>Replay</button>
            <button type="button" onClick={toggleSound} disabled={!narration} aria-pressed={soundEnabled}>{narration ? (soundEnabled ? 'Mute' : 'Unmute') : 'Sound unavailable'}</button>
          </div>
        </div>
      </div>
      {audioBlocked && <p className="sr-audio-note" role="status">This browser blocked audio. Press Unmute to try again, or follow the captions below.</p>}
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
      {narration && <audio ref={audioRef} src={narration.src} preload="auto" aria-label="Rosina’s narration" />}
      <p className="sr-footnote">A replay of the demo flow with fictional people. The narration is Rosina’s real ElevenLabs voice, recorded once through the app’s own voice path; the Village map is the real OpenFreeMap-based map this app uses. The phones reconstruct the real steps of the journey. Loretta’s reply and Kendra’s confirmation are separate decisions, and no pickup is actually arranged.</p>
    </div>
  </section>
}
