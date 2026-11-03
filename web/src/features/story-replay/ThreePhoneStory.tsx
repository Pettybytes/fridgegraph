import { useCallback, useEffect, useRef, useState } from 'react'
import { PhoneReplay } from './PhoneReplay'
import { projectStory, storyBeat, storyDurationMs, VOICE_START_MS, type Viewer } from './story'
import { ILLUSTRATIVE_VOICE, type StoryVoice } from './storyVoice'
import './story-replay.css'

export type ThreePhoneStoryProps = { voice?: StoryVoice | null; initialAutoplay?: boolean }
const VIEWERS: readonly Viewer[] = ['parent', 'caregiver', 'teacher']
const reducedPreference = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function ThreePhoneStory({ voice = ILLUSTRATIVE_VOICE, initialAutoplay = true }: ThreePhoneStoryProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const elapsedRef = useRef(0)
  const frameRef = useRef(0)
  const previousFrameRef = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState(() => reducedPreference() ? storyDurationMs(voice?.durationMs) : 0)
  const [playing, setPlaying] = useState(() => initialAutoplay && !reducedPreference())
  const [manualPause, setManualPause] = useState(false)
  const [visible, setVisible] = useState(true)
  const [tabVisible, setTabVisible] = useState(!document.hidden)
  const [selected, setSelected] = useState<Viewer>('parent')
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [loopsCompleted, setLoopsCompleted] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(reducedPreference)
  const duration = storyDurationMs(voice?.durationMs)

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
          if (audioRef.current && !audioRef.current.paused) audioRef.current.pause()
          if (audioRef.current) audioRef.current.currentTime = 0
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

  // One audio element follows the master clock; each loop stops and rewinds it first.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !voice) return
    const within = elapsed >= VOICE_START_MS && elapsed < VOICE_START_MS + voice.durationMs
    if (!soundEnabled || !active || !within) { if (!audio.paused) audio.pause(); return }
    const target = (elapsed - VOICE_START_MS) / 1000
    if (Math.abs(audio.currentTime - target) > 0.18) audio.currentTime = target
    if (audio.paused) {
      try { void audio.play()?.catch(() => setSoundEnabled(false)) }
      catch { setSoundEnabled(false) }
    }
  }, [active, elapsed, soundEnabled, voice])

  const pause = useCallback(() => { setPlaying(false); setManualPause(true); audioRef.current?.pause() }, [])
  const play = useCallback(() => {
    if (elapsedRef.current >= duration) { elapsedRef.current = 0; setElapsed(0); setLoopsCompleted(0) }
    setManualPause(false); setPlaying(true)
  }, [duration])
  const replay = useCallback(() => { elapsedRef.current = 0; setElapsed(0); setLoopsCompleted(0); audioRef.current?.pause(); if (audioRef.current) audioRef.current.currentTime = 0; setManualPause(false); setPlaying(true) }, [])
  const toggleSound = useCallback(() => {
    if (!voice) return
    if (soundEnabled) { audioRef.current?.pause(); setSoundEnabled(false); return }
    setSoundEnabled(true)
    const audio = audioRef.current
    if (audio && active && elapsedRef.current >= VOICE_START_MS && elapsedRef.current < VOICE_START_MS + voice.durationMs) {
      audio.currentTime = (elapsedRef.current - VOICE_START_MS) / 1000
      try { void audio.play()?.catch(() => setSoundEnabled(false)) }
      catch { setSoundEnabled(false) }
    }
  }, [active, soundEnabled, voice])
  const progress = Math.min(100, elapsed / duration * 100)
  const beat = storyBeat(elapsed, voice?.durationMs)

  return <section className="sr" ref={sectionRef} aria-labelledby="sr-title" data-playing={active} data-reduced-motion={reducedMotion} data-loop-count={loopsCompleted}>
    <div className="sr-backdrop" aria-hidden="true" />
    <div className="sr-inner">
      <div className="sr-heading"><div><p className="sr-eyebrow">Demo story replay · illustrative fixture</p><h2 id="sr-title">One plan, three perspectives</h2><p>School changes the day. Loretta offers. Kendra confirms the pickup plan.</p></div>
        <div className="sr-controls" aria-label="Story playback controls">
          <button type="button" onClick={active ? pause : play}>{active ? 'Pause' : 'Play'}</button>
          <button type="button" onClick={replay}>Replay</button>
          <button type="button" onClick={toggleSound} disabled={!voice} aria-pressed={soundEnabled}>{voice ? (soundEnabled ? 'Sound on' : 'Sound off') : 'Sound unavailable'}</button>
        </div>
      </div>
      <div className="sr-progress" role="progressbar" aria-label="Story progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div>
      <p className="sr-caption">{beat}</p>
      <div className="sr-perspectives" aria-label="Choose a perspective">
        {VIEWERS.map(viewer => <button key={viewer} type="button" aria-pressed={selected === viewer} onClick={() => setSelected(viewer)}>{viewer === 'parent' ? 'Parent' : viewer === 'caregiver' ? 'Caregiver' : 'Teacher'}</button>)}
      </div>
      <div className="sr-grid">
        {VIEWERS.map(viewer => <div className={selected === viewer ? 'sr-mobile-active' : ''} key={viewer}><PhoneReplay viewer={viewer} events={projectStory(viewer, elapsed, voice?.durationMs).map(event => voice && (event.id === 'offer' || event.id === 'parent-offer') ? { ...event, body: voice.transcript } : event)} voicePeaks={viewer === 'caregiver' ? voice?.peaks : undefined} /></div>)}
      </div>
      {voice && <audio ref={audioRef} src={voice.src} preload="auto" aria-label="Loretta’s voice note" />}
      <p className="sr-footnote">Illustrative fictional replay. Loretta’s offer and Kendra’s confirmation are separate; pickup completion not recorded.</p>
    </div>
  </section>
}
