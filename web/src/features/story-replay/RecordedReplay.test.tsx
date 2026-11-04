// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {RecordedReplay} from './RecordedReplay'

beforeEach(()=>{
 vi.useFakeTimers()
 vi.stubGlobal('IntersectionObserver',class {observe(){} disconnect(){}})
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>setTimeout(()=>cb(performance.now()),16))
 vi.stubGlobal('cancelAnimationFrame',clearTimeout)
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}))
})
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
function mount(){
 const result=render(<RecordedReplay/>),media=Array.from(result.container.querySelectorAll<HTMLMediaElement>('video,audio'))
 const states=media.map(element=>{
  const state={paused:true,ready:4,seeking:false,ended:false}
  Object.defineProperties(element,{paused:{get:()=>state.paused},readyState:{get:()=>state.ready},seeking:{get:()=>state.seeking},ended:{get:()=>state.ended}})
  vi.spyOn(element,'play').mockImplementation(()=>{state.paused=false;return Promise.resolve()})
  vi.spyOn(element,'pause').mockImplementation(()=>{state.paused=true})
  return state
 })
 return {media,states,...result}
}
const tick=async()=>{await act(async()=>{vi.advanceTimersByTime(32)})}
it('shows posters before loading recordings and uses exactly one narration element',()=>{
 const {media}=mount()
 expect(media).toHaveLength(4)
 for(const video of media.slice(0,3)){expect(video).toHaveAttribute('poster');expect(video).not.toHaveAttribute('src')}
 expect(screen.getByRole('button',{name:'Play'})).toBeEnabled()
 expect(screen.getByText(/run stops before caregiver reply/)).toBeVisible()
})
it('pauses the whole group when one track buffers and resumes together',async()=>{
 const {states}=mount()
 fireEvent.click(screen.getByRole('button',{name:'Play'}));await tick()
 expect(states.slice(0,3).every(s=>!s.paused)).toBe(true)
 states[2].ready=2;await tick()
 expect(states.slice(0,3).every(s=>s.paused)).toBe(true)
 expect(screen.getByRole('status')).toHaveTextContent('Loading synchronized playback')
 states[2].ready=4;await tick()
 expect(states.slice(0,3).every(s=>!s.paused)).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Pause'}));await tick()
 expect(states.every(s=>s.paused)).toBe(true)
})
it('corrects a drifting track, preserves time through perspective changes, and replays from zero',async()=>{
 const {media}=mount()
 fireEvent.click(screen.getByRole('button',{name:'Play'}));await tick()
 media[0].currentTime=5;media[1].currentTime=5.3;media[2].currentTime=5
 await tick();expect(media[1].currentTime).toBe(5)
 fireEvent.click(screen.getByRole('button',{name:'Village'}));expect(media[0].currentTime).toBe(5)
 fireEvent.click(screen.getByRole('button',{name:'Replay'}));expect(media.every(m=>m.currentTime===0)).toBe(true)
})
it('unlocks the single audio element on a gesture and stops before uncaptured narration',async()=>{
 const {media,states}=mount(),audio=media[3]
 fireEvent.click(screen.getByRole('button',{name:'Play'}));await tick()
 fireEvent.click(screen.getByRole('button',{name:'Sound off'}));await tick()
 expect(audio.play).toHaveBeenCalled();expect(states[3].paused).toBe(false)
 for(const video of media.slice(0,3))video.currentTime=20
 await tick();expect(states[3].paused).toBe(true)
 expect(screen.getByText(/run is waiting for a caregiver reply/,{selector:'.sr-caption'})).toBeVisible()
})
it('shows a recoverable playback error without leaving a false playing state',async()=>{
 const {media}=mount()
 vi.mocked(media[1].play).mockRejectedValueOnce(new Error('NotAllowedError'))
 fireEvent.click(screen.getByRole('button',{name:'Play'}));await tick()
 expect(screen.getByRole('alert')).toHaveTextContent('Playback could not start')
 expect(screen.getByRole('button',{name:'Play'})).toBeEnabled()
})
