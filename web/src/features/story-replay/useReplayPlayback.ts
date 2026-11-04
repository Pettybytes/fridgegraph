import { useCallback, useEffect, useRef, useState } from 'react'

/** Audio is the sole clock. Only an explicit Replay seeks it; videos may catch up.
 * Playback never starts on mount, pointer-down, readiness events, or sound toggles. */
export function useReplayPlayback(durationSeconds: number) {
  const sectionRef = useRef<HTMLElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const canPlayThrough = useRef(false)
  const requested = useRef(false)
  const pendingVideos = useRef(new WeakSet<HTMLVideoElement>())

  const pause = useCallback(() => {
    requested.current = false
    audioRef.current?.pause()
    videoRefs.current.forEach(video => video?.pause())
    setPlaying(false)
  }, [])

  const checkReady = useCallback(() => {
    const audio = audioRef.current
    // canplaythrough alone is a browser estimate. Require the entire resource buffered.
    const full = !!audio && canPlayThrough.current && Number.isFinite(audio.duration) &&
      audio.buffered.length > 0 && audio.buffered.start(0) <= 0.05 &&
      audio.buffered.end(audio.buffered.length - 1) >= audio.duration - 0.05
    setReady(full)
  }, [])

  const play = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !ready) return
    setError(''); requested.current = true
    void audio.play().then(() => {
      if (!requested.current) audio.pause()
    }).catch(() => {
      requested.current = false; setPlaying(false)
      setError('Playback could not start. Press Play to try again.')
    })
  }, [ready])

  const replay = useCallback(() => {
    pause()
    if (audioRef.current) audioRef.current.currentTime = 0
    videoRefs.current.forEach(video => {
      if (video?.error) video.load()
      else if (video && video.readyState > 0) video.currentTime = 0
    })
    setElapsed(0); play()
  }, [pause, play])

  const toggleSound = useCallback(() => {
    setSoundEnabled(enabled => !enabled)
    // Muting is rendered onto the existing element. No play(), pause() or seeking here.
  }, [])

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const change = () => { setReducedMotion(query?.matches ?? false); if (query?.matches) pause() }
    query?.addEventListener('change', change)
    const hidden = () => { if (document.hidden) pause() }
    document.addEventListener('visibilitychange', hidden)
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) pause() }, { threshold: 0 })
    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => { observer.disconnect(); query?.removeEventListener('change', change); document.removeEventListener('visibilitychange', hidden) }
  }, [pause])

  useEffect(() => {
    let frame = 0
    const tick = () => {
      const audio = audioRef.current
      if (audio) {
        const time = Math.min(audio.currentTime, durationSeconds)
        setElapsed(time)
        if (audio.ended) { requested.current = false; setPlaying(false) }
        for (const video of videoRefs.current) {
          if (!video) continue
          if (audio.paused || audio.ended) { if (!video.paused) video.pause(); continue }
          if (video.readyState < 2 || video.seeking) continue
          // Video decoding can recover independently; it never rewinds or stalls narration.
          if (Math.abs(video.currentTime - time) > 0.08) video.currentTime = time
          video.playbackRate = audio.playbackRate
          if (video.paused && !video.ended && !pendingVideos.current.has(video)) {
            pendingVideos.current.add(video)
            void video.play().catch(error => {
              if (error?.name !== 'AbortError') setError('A video could not play. Press Replay to try again.')
            }).finally(() => pendingVideos.current.delete(video))
          }
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [durationSeconds])

  const audioEvents = {
    onCanPlayThrough: () => { canPlayThrough.current = true; checkReady() },
    onProgress: checkReady,
    onLoadedMetadata: checkReady,
    onPlaying: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => { requested.current = false; setPlaying(false); setElapsed(durationSeconds) },
    onError: () => { pause(); setReady(false); setError('Narration could not load. Reload this page to try again.') },
  }
  return {sectionRef, audioRef, videoRefs, elapsed, playing, soundEnabled, ready, error, reducedMotion, play, pause, replay, toggleSound, audioEvents}
}
