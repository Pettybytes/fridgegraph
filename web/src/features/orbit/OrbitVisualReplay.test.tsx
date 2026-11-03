// @vitest-environment jsdom
import {act, fireEvent, render, screen} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import type {Alert} from './adapter'
import {OrbitConstellation} from './OrbitConstellation'
import {OrbitResolution} from './OrbitResolution'
import {OrbitVisualReplay, replayFrame, REPLAY_DURATION_MS} from './OrbitVisualReplay'
import {OrbitConfetti} from './OrbitConfetti'
const motionSetting = vi.hoisted(() => ({reduced:false}))
vi.mock('motion/react', async original => ({...await original<typeof import('motion/react')>(), useReducedMotion: () => motionSetting.reduced}))

const audience = [
  {person: {id: 'loretta', displayName: 'Loretta'}, eligible: true},
  {person: {id: 'dana', displayName: 'Dana'}, eligible: true},
  {person: {id: 'hidden', displayName: 'Hidden'}, eligible: false},
]
const active: Alert = {id:'a1',status:'ACTIVE',child:{id:'nora'},message:null,share:{photoId:null},activatedAt:'2026-11-02T18:00:00Z',closedAt:null,audience,responses:[],latestResponses:[],guidance:''}
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()})

it('reveals only eligible, caller-visible people; silence stays pending', () => {
  const view = render(<OrbitConstellation alert={active} childName="Nora" parent viewerId="kendra" portraitFor={() => undefined}/>)
  expect(screen.getAllByText('No response yet').length).toBeGreaterThan(0)
  expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  view.rerender(<OrbitConstellation alert={active} childName="Nora" parent={false} viewerId="loretta" portraitFor={() => undefined}/>)
  expect(screen.queryByText('Dana')).not.toBeInTheDocument()
  expect(screen.getAllByText('Loretta').length).toBeGreaterThan(0)
})

it('a recorded response changes the satellite and ledger, but WITH_ME remains a report', () => {
  const view = render(<OrbitConstellation alert={active} childName="Nora" parent viewerId="kendra" portraitFor={() => undefined}/>)
  const response = {person:{id:'dana',displayName:'Dana'},response:'WITH_ME',respondedAt:'2026-11-02T18:12:00Z'}
  view.rerender(<OrbitConstellation alert={{...active,responses:[response],latestResponses:[response]}} childName="Nora" parent viewerId="kendra" portraitFor={() => undefined}/>)
  expect(screen.getAllByText('Reported: with me')).toHaveLength(2)
  expect(screen.getByText(/the parent decides when to close Orbit/i)).toBeInTheDocument()
  expect(screen.queryByText('Found safe')).not.toBeInTheDocument()
  expect(screen.getByRole('list').querySelector('time[datetime="2026-11-02T18:12:00Z"]')).not.toBeNull()
})

it('the fictional sequence waits for activation, staggers responses, then explicitly closes', () => {
  expect(replayFrame(0)).toEqual({phase:'preparing',alert:null})
  expect(replayFrame(2999).alert).toBeNull()
  expect(replayFrame(3000).alert?.status).toBe('ACTIVE')
  expect(replayFrame(8999).alert?.latestResponses).toHaveLength(0)
  expect(replayFrame(9000).alert?.latestResponses).toHaveLength(1)
  expect(replayFrame(13000).alert?.latestResponses).toHaveLength(2)
  expect(replayFrame(15999).alert?.status).toBe('ACTIVE')
  expect(replayFrame(16000).alert?.closeOutcome).toBe('FOUND_SAFE')
  expect(REPLAY_DURATION_MS).toBe(20000)
})

it('resolved presentation has no portrait, satellite, private message or location', () => {
  render(<OrbitResolution childName="Nora Ellison" thankyou="Thank you for responding." closedAt="2026-11-02T18:16:00Z" parentConfirmed/>)
  expect(screen.getByText('Found safe')).toBeInTheDocument()
  expect(screen.getByText('You confirmed found safe', {exact:false})).toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.queryByText(/Loretta|Dana|last seen|description/i)).not.toBeInTheDocument()
  expect(document.querySelector('.orbit-confetti')).toBeNull()
})

it('preview plays, pauses, and replays without any transport', () => {
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','requestAnimationFrame','cancelAnimationFrame']})
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  vi.stubGlobal('IntersectionObserver', class {observe() {} disconnect() {}})
  render(<OrbitVisualReplay/>)
  expect(screen.getByText(/No alert is active yet/)).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(5000))
  expect(screen.getByText('Orbit active.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Pause'}))
  const progress = screen.getByRole('progressbar').getAttribute('aria-valuenow')
  act(() => vi.advanceTimersByTime(4000))
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow',progress)
  fireEvent.click(screen.getByRole('button',{name:'Replay'}))
  expect(screen.getByText(/No alert is active yet/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Capture response'}))
  expect(screen.getByText('Orbit active.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Capture resolution'}))
  expect(screen.getByText('Found safe')).toBeInTheDocument()
  expect(request).not.toHaveBeenCalled()
})

it('reduced motion opens on a static resolved frame without confetti', () => {
  motionSetting.reduced = true
  render(<OrbitVisualReplay/>)
  expect(screen.getByText('Found safe')).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100')
  expect(document.querySelector('.orbit-confetti')).toBeNull()
  motionSetting.reduced = false
})

it('the bounded particle layer stops when the tab is hidden', () => {
  let hidden = false
  vi.spyOn(document,'hidden','get').mockImplementation(() => hidden)
  const view = render(<OrbitConfetti/>)
  expect(document.querySelector('.orbit-confetti')).toHaveAttribute('data-particles','72')
  hidden = true
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(document.querySelector('.orbit-confetti')).toBeNull()
  view.unmount()
})
