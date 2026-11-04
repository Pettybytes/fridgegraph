// @vitest-environment jsdom
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {ThreePhoneStory} from './ThreePhoneStory'
import {RecordedReplay} from './RecordedReplay'
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
for(const [name,Component] of [['illustrative',ThreePhoneStory],['recorded',RecordedReplay]] as const){
 it(`${name}: sound is explicitly muted and no pointer gesture starts audio`,()=>{
  vi.stubGlobal('IntersectionObserver',class {observe(){}disconnect(){}})
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}))
  const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{})
  const {container}=render(<Component/>);const audio=container.querySelector('audio')!
  expect(audio.muted).toBe(true)
  expect(audio.preload).toBe('auto')
  expect(screen.getByRole('button',{name:'Tap to turn sound on'})).toHaveAttribute('aria-pressed','false')
  fireEvent.pointerDown(container.querySelector('section')!)
  expect(play).not.toHaveBeenCalled()
 })
}
