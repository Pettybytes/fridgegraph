import {useEffect, useRef, useState} from 'react'
import {useReducedMotion} from 'motion/react'
import {portraitFor} from '@/components/fg/portraits'
import type {Alert} from './adapter'
import {OrbitConstellation} from './OrbitConstellation'
import {OrbitResolution} from './OrbitResolution'
import './alert-ui.css'
import './orbit.css'

const base: Alert = {
  id: 'illustrative-orbit', child: {id: 'p_nora'}, status: 'ACTIVE',
  message: null, share: {photoId: null}, activatedAt: '2026-11-02T18:00:00Z', closedAt: null,
  audience: [
    // Matches Nora's fictional orbit_notify_eligible household policy.
    {person: {id: 'p_dad', displayName: 'Andre Ellison'}, eligible: true},
    {person: {id: 'p_gma', displayName: 'Loretta Brooks'}, eligible: true},
    {person: {id: 'p_bryan', displayName: 'Bryan Brooks'}, eligible: true},
  ], responses: [], latestResponses: [], guidance: '',
}
const offer = {person: {id: 'p_gma', displayName: 'Loretta Brooks'}, response: 'ON_WAY', respondedAt: '2026-11-02T18:08:00Z'}
const report = {person: {id: 'p_bryan', displayName: 'Bryan Brooks'}, response: 'WITH_ME', respondedAt: '2026-11-02T18:12:00Z'}
export const REPLAY_DURATION_MS = 20000
export function replayFrame(elapsed: number): {phase: 'preparing' | 'active' | 'found'; alert: Alert | null} {
  if (elapsed < 3000) return {phase: 'preparing', alert: null}
  const responses = elapsed < 9000 ? [] : elapsed < 13000 ? [offer] : [offer, report]
  if (elapsed < 16000) return {phase: 'active', alert: {...base, responses, latestResponses: responses}}
  return {phase: 'found', alert: {...base, status: 'CLOSED', closeOutcome: 'FOUND_SAFE', closedAt: '2026-11-02T18:16:00Z', thankyou: 'Thank you for responding.', responses, latestResponses: responses}}
}

export function OrbitVisualReplay() {
  const reduced = useReducedMotion()
  const [elapsed, setElapsed] = useState(() => reduced ? REPLAY_DURATION_MS : 0)
  const [playing, setPlaying] = useState(() => !reduced)
  const [visible, setVisible] = useState(() => !document.hidden)
  const [intersecting, setIntersecting] = useState(true)
  const clock = useRef(elapsed)
  const last = useRef<number | null>(null)
  const root = useRef<HTMLElement>(null)
  useEffect(() => { if (reduced) { clock.current = REPLAY_DURATION_MS; setElapsed(REPLAY_DURATION_MS); setPlaying(false) } }, [reduced])
  useEffect(() => {
    const change = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !root.current) return
    const observer = new IntersectionObserver(([entry]) => setIntersecting(entry?.isIntersecting ?? false), {threshold: .1})
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!playing || !visible || !intersecting) { last.current = null; return }
    let frame = 0
    const tick = (now: number) => {
      if (last.current !== null) {
        clock.current = Math.min(REPLAY_DURATION_MS, clock.current + now - last.current)
        setElapsed(clock.current)
        if (clock.current >= REPLAY_DURATION_MS) { setPlaying(false); return }
      }
      last.current = now
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {cancelAnimationFrame(frame); last.current = null}
  }, [playing, visible, intersecting])
  const {phase, alert} = replayFrame(elapsed)
  const replay = () => { clock.current = 0; setElapsed(0); setPlaying(true) }
  const frame = (at: number) => { clock.current = at; setElapsed(at); setPlaying(false) }
  const togglePlay = () => { if (!playing && clock.current >= REPLAY_DURATION_MS) {replay(); return} setPlaying(value => !value) }
  return <main className="orbit-replay" ref={root} data-phase={phase}>
    <div className="orbit-replay-toolbar"><div><strong>Orbit · visual replay</strong><span>Fictional fixture. No live alert or notification.</span></div><div><button type="button" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button><button type="button" onClick={replay}>Replay</button><button type="button" onClick={() => frame(11000)}>Capture response</button><button type="button" onClick={() => frame(17500)}>Capture resolution</button></div></div>
    <div className="orbit-replay-stage">
      {phase === 'preparing' && <div className="orbit-replay-preparing"><h1>Parent review</h1><p>Orbit activation is being prepared. No alert is active yet.</p></div>}
      {phase === 'active' && alert && <div className="orbit-glass-scene"><div className="orbit-glass-heading"><p>Illustrative Orbit fixture</p><h1>Orbit active.</h1><p>The approved village can respond. No response is inferred from silence.</p></div><OrbitConstellation alert={alert} childName="Nora Ellison" childPortrait={portraitFor({personId:'p_nora'})} parent viewerId="p_mom" portraitFor={id=>portraitFor({personId:id})}/></div>}
      {phase === 'found' && alert && <OrbitResolution childName="Nora Ellison" thankyou={alert.thankyou} closedAt={alert.closedAt} parentConfirmed celebrate={!reduced && elapsed < 19000}/>}
    </div>
    <p className="orbit-replay-caption" aria-live="off">{phase === 'preparing' ? 'Parent review precedes activation.' : phase === 'active' ? elapsed < 9000 ? 'Orbit is active. Responses are pending.' : elapsed < 13000 ? 'Loretta offers to help.' : 'Bryan reports “with me.” Only the parent closes Orbit.' : 'The parent explicitly closed Orbit as found safe.'}</p>
    <div className="orbit-replay-progress" role="progressbar" aria-label="Replay progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(elapsed / REPLAY_DURATION_MS * 100)}><span style={{width:`${elapsed / REPLAY_DURATION_MS * 100}%`}}/></div>
  </main>
}
