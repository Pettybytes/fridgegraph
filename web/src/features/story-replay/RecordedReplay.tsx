import { useEffect, useRef, useState } from 'react'
import { RosinaAvatar } from '@/components/fg/RosinaAvatar'
import { RECORDING } from './recording'
import './story-replay.css'

const PANES = ['Parent', 'Under the hood', 'Village'] as const
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Three silent exports share the parent video's media clock and one narration element.
 * Buffering any track pauses the entire group; rendering never advances a synthetic clock. */
export function RecordedReplay() {
  const section = useRef<HTMLElement>(null)
  const videos = useRef<(HTMLVideoElement | null)[]>([])
  const audio = useRef<HTMLAudioElement>(null)
  const wantsPlay = useRef(false)
  const sound = useRef(false)
  const starting = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState('')
  const [buffering, setBuffering] = useState(false)
  const inView = useRef(true)

  const pauseMedia = () => { videos.current.forEach(video => video?.pause()); audio.current?.pause(); setPlaying(false) }
  const pause = () => { wantsPlay.current = false; pauseMedia(); setBuffering(false) }
  const play = () => { setError(''); setLoaded(true); wantsPlay.current = true; setBuffering(true) }
  const replay = () => {
    pauseMedia()
    videos.current.forEach(video => { if (video?.error) video.load(); else if (video && video.readyState > 0) video.currentTime = 0 })
    if (audio.current) audio.current.currentTime = 0
    setElapsed(0); play()
  }
  const toggleSound = () => {
    if (!audio.current) return
    const enable = !sound.current
    sound.current = enable; setMuted(!enable)
    audio.current.muted = !enable
    if (!enable) { audio.current.pause(); return }
    audio.current.currentTime = videos.current[0]?.currentTime ?? 0
    // Call play in this click handler for Safari's user-gesture requirement.
    void audio.current.play().then(() => {
      if (!wantsPlay.current) audio.current?.pause()
    }).catch(() => {
      sound.current = false; setMuted(true)
      setError('Audio could not start. Press Sound off to try again.')
    })
  }

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const onReduce = () => { if (query?.matches) { wantsPlay.current = false; pauseMedia() } }
    query?.addEventListener('change', onReduce)
    const observer = new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting
      if (entry.isIntersecting) setLoaded(true)
      else pauseMedia()
    }, { threshold: 0.1 })
    if (section.current) observer.observe(section.current)
    return () => { observer.disconnect(); query?.removeEventListener('change', onReduce) }
  }, [])

  useEffect(() => {
    let frame = 0, disposed = false
    const tick = () => {
      const tracks = videos.current.filter((video): video is HTMLVideoElement => video !== null)
      const master = tracks[0]
      if (master) setElapsed(master.currentTime)
      if (master?.ended) { wantsPlay.current = false; pauseMedia(); setBuffering(false) }
      const ready = tracks.length === 3 && tracks.every(video => video.readyState >= 3 && !video.seeking)
      if (!wantsPlay.current || !inView.current || document.hidden || !ready) {
        if (tracks.some(video => !video.paused)) pauseMedia()
        if (wantsPlay.current && inView.current && !document.hidden) setBuffering(true)
      } else if (master && !starting.current) {
        const target = master.currentTime
        const drifting = tracks.slice(1).filter(video => Math.abs(video.currentTime - target) > 0.08)
        if (drifting.length) {
          pauseMedia(); drifting.forEach(video => { video.currentTime = target })
        } else {
          const narration = audio.current
          if (narration && sound.current && target < RECORDING.audioEndSeconds) {
            if (Math.abs(narration.currentTime - target) > 0.08) narration.currentTime = target
          } else narration?.pause()
          if (tracks.some(video => video.paused)) {
            starting.current = true
            const media: HTMLMediaElement[] = [...tracks]
            if (narration && sound.current && target < RECORDING.audioEndSeconds) media.push(narration)
            void Promise.all(media.map(item => item.play())).then(() => {
              if (!disposed && wantsPlay.current && inView.current && !document.hidden) { setPlaying(true); setBuffering(false) }
              else media.forEach(item => item.pause())
            }).catch(error => {
              if (!disposed && error?.name !== 'AbortError') { wantsPlay.current = false; pauseMedia(); setBuffering(false); setError('Playback could not start. Press Play to try again.') }
            }).finally(() => { starting.current = false })
          } else if (narration && sound.current && narration.paused && target < RECORDING.audioEndSeconds) {
            void narration.play().catch(() => { sound.current = false; setMuted(true); setError('Audio could not start. Press Sound off to try again.') })
          }
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { disposed = true; cancelAnimationFrame(frame) }
  }, [])

  const caption = RECORDING.captions.find(cue => elapsed >= cue.start && elapsed < cue.end)?.text ?? ''
  const progress = Math.min(100, elapsed / RECORDING.durationSeconds * 100)
  return <section ref={section} className="sr sr-recorded" aria-labelledby="recorded-replay-title" data-playing={playing} data-reduced-motion={reduced()}>
    <div className="sr-backdrop" aria-hidden="true" />
    <div className="sr-inner">
      <div className="sr-heading">
        <div><h2 id="recorded-replay-title">One plan, three perspectives</h2><p>Recorded run of the real app · fictional people</p></div>
        <div className="sr-player" aria-label="Replay playback">
          <RosinaAvatar size={44} state={playing && !muted && elapsed < RECORDING.audioEndSeconds ? 'speaking' : 'ready'} />
          <div className="sr-controls">
            <button type="button" onClick={playing || buffering ? pause : elapsed >= RECORDING.durationSeconds - 0.1 ? replay : play}>{playing || buffering ? 'Pause' : 'Play'}</button>
            <button type="button" onClick={replay}>Replay</button>
            <button type="button" onClick={toggleSound} aria-pressed={!muted}>{muted ? 'Sound off' : 'Sound on'}</button>
          </div>
        </div>
      </div>
      <p className="sr-footnote">{RECORDING.disclosure}</p>
      {error && <p role="alert" className="sr-audio-note">{error}</p>}
      <p role="status" className="sr-recorded-status">{buffering ? 'Loading synchronized playback…' : ''}</p>
      <div className="sr-progress" role="progressbar" aria-label="Replay progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
      <p className="sr-caption">{caption}</p>
      <div className="sr-perspectives" aria-label="Choose a phone">{PANES.map((name, index) => <button key={name} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>{name}</button>)}</div>
      <div className="sr-grid">{RECORDING.tracks.map((track, index) => <figure key={track.src} className={`sr-view sr-view--${['parent', 'trace', 'village'][index]}${selected === index ? ' sr-mobile-active' : ''}`}>
        <div className="sr-card"><div className="sr-card-image" aria-hidden="true" /><div className="sr-phone sr-phone--recorded"><div className="sr-screen">
          <video ref={node => { videos.current[index] = node }} src={loaded ? track.src : undefined} poster={track.poster} preload="auto" muted playsInline aria-label={`${PANES[index]} recorded footage`} onError={() => { pause(); setError('A recording could not load. Press Replay to retry.') }} />
        </div></div></div><figcaption><strong>{PANES[index]}</strong><span aria-hidden="true"> · </span>{track.description}</figcaption>
      </figure>)}</div>
      <audio ref={audio} src={RECORDING.audioSrc} preload="none" aria-label="Rosina’s narration" />
      <details className="sr-footnote"><summary>About this recording and transcript</summary><p>{RECORDING.provenance}</p>{RECORDING.captions.map(cue => <p key={cue.start}>{cue.text}</p>)}</details>
    </div>
  </section>
}
