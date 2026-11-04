// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, within} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {RecordedReplay} from './RecordedReplay'
import {ThreePhoneStory} from './ThreePhoneStory'

beforeEach(()=>{
 vi.useFakeTimers()
 vi.stubGlobal('IntersectionObserver',class {observe(){} disconnect(){}})
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>setTimeout(()=>cb(performance.now()),16))
 vi.stubGlobal('cancelAnimationFrame',clearTimeout)
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}))
})
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
function mount(Component:typeof RecordedReplay | typeof ThreePhoneStory){
 const result=render(<Component/>),media=Array.from(result.container.querySelectorAll<HTMLMediaElement>('video,audio'))
 const states=media.map(element=>{
  const state={paused:true,ready:4,seeking:false,ended:false,bufferedEnd:34}
  Object.defineProperties(element,{paused:{get:()=>state.paused},readyState:{get:()=>state.ready},seeking:{get:()=>state.seeking},ended:{get:()=>state.ended},duration:{get:()=>34},buffered:{get:()=>({length:1,start:()=>0,end:()=>state.bufferedEnd})}})
  vi.spyOn(element,'play').mockImplementation(()=>{state.paused=false;fireEvent.playing(element);return Promise.resolve()})
  vi.spyOn(element,'pause').mockImplementation(()=>{state.paused=true;fireEvent.pause(element)})
  return state
 })
 const audio=result.container.querySelector('audio')!
 return {media,states,audio,...result}
}
const tick=async()=>{await act(async()=>{vi.advanceTimersByTime(32)})}
for(const [name,Component] of [['recorded',RecordedReplay],['illustrative',ThreePhoneStory]] as const){
 it(`${name}: waits for canplaythrough AND the complete narration without autoplay`,()=>{
  const {audio,states}=mount(Component)
  expect(screen.getByRole('button',{name:'Play'})).toBeDisabled()
  states.at(-1)!.bufferedEnd=20;fireEvent.canPlayThrough(audio)
  expect(screen.getByRole('button',{name:'Play'})).toBeDisabled()
  states.at(-1)!.bufferedEnd=34;fireEvent.progress(audio)
  expect(screen.getByRole('button',{name:'Play'})).toBeEnabled()
  expect(audio.play).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Tap to turn sound on'}))
  expect(audio.muted).toBe(false)
  expect(screen.getByRole('button',{name:'Sound on'})).toHaveAttribute('aria-pressed','true')
  expect(audio.play).not.toHaveBeenCalled()
 })
 it(`${name}: follows only audio time, never seeks narration during playback or sound toggles`,async()=>{
  const {audio,media}=mount(Component)
  fireEvent.canPlayThrough(audio);fireEvent.click(screen.getByRole('button',{name:'Play'}))
  audio.currentTime=5
  const seek=vi.spyOn(audio,'currentTime','set')
  await tick()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','15')
  await act(async()=>{vi.advanceTimersByTime(3000)})
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','15')
  fireEvent.click(screen.getByRole('button',{name:'Tap to turn sound on'}));fireEvent.click(screen.getByRole('button',{name:'Sound on'}))
  fireEvent.click(screen.getByRole('button',{name:'Village'}));await tick()
  expect(seek).not.toHaveBeenCalled()
  expect(media.filter(m=>m.tagName==='VIDEO').every(m=>m.currentTime===5)).toBe(true)
  fireEvent.click(screen.getByRole('button',{name:'Pause'}));expect(audio.paused).toBe(true)
  fireEvent.click(screen.getByRole('button',{name:'Replay'}));expect(seek).toHaveBeenCalledExactlyOnceWith(0)
 })
 it(`${name}: reports playback rejection and remains paused`,async()=>{
  const {audio}=mount(Component);fireEvent.canPlayThrough(audio)
  vi.mocked(audio.play).mockRejectedValueOnce(new Error('NotAllowedError'))
  fireEvent.click(screen.getByRole('button',{name:'Play'}));await tick()
  expect(screen.getByRole('alert')).toHaveTextContent('Playback could not start')
  expect(screen.getByRole('button',{name:'Play'})).toBeEnabled()
 })
 it(`${name}: reduced motion starts paused and the completed replay does not loop`,async()=>{
  vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}))
  const {audio,states,container}=mount(Component);fireEvent.canPlayThrough(audio)
  expect(container.querySelector('section')).toHaveAttribute('data-playing','false')
  expect(audio.play).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Play'}));await tick()
  audio.currentTime=34;states.at(-1)!.ended=true;states.at(-1)!.paused=true;fireEvent.ended(audio);await tick()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100')
  expect(audio.play).toHaveBeenCalledTimes(1)
 })
}
it('lets video decoding recover without pausing or seeking narration',async()=>{
 const {audio,media,states}=mount(RecordedReplay);fireEvent.canPlayThrough(audio)
 fireEvent.click(screen.getByRole('button',{name:'Play'}));await tick()
 const seek=vi.spyOn(audio,'currentTime','set')
 states[1].ready=1;await tick()
 expect(audio.pause).not.toHaveBeenCalled();expect(audio.paused).toBe(false)
 states[1].ready=4;media[1].currentTime=3;await tick()
 expect(media[1].currentTime).toBe(audio.currentTime);expect(seek).not.toHaveBeenCalled()
})
it('retains populated illustrative phones and separate caregiver and parent decisions',async()=>{
 const {audio,container}=mount(ThreePhoneStory)
 expect(screen.getByText('Good afternoon, Kendra')).toBeInTheDocument()
 expect(screen.getByRole('img',{name:/real Village map/})).toBeInTheDocument()
 expect(container.querySelectorAll('audio')).toHaveLength(1)
 expect(container.querySelectorAll('.sr-replay-chip')).toHaveLength(3)
 expect(screen.getByText(/no pickup is actually arranged/)).toBeInTheDocument()
 audio.currentTime=34;await tick()
 const journey=screen.getByLabelText('Kendra’s replayed journey')
 expect(within(journey).getByText(/Confirm Loretta for the pickup/)).toBeInTheDocument()
 expect(within(journey).getByRole('img',{name:/Waveform derived/})).toBeInTheDocument()
})
