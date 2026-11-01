import {renderHook,act,cleanup} from '@testing-library/react'
import {it,expect,vi,afterEach} from 'vitest'
import {useReducedMotion} from './useMapReducedMotion'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('an existing workflow responds when reduced motion is turned on or off',()=>{let reduced=false;const listeners=new Set<()=>void>();vi.stubGlobal('matchMedia',()=>({matches:reduced,addEventListener:(_:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_:string,fn:()=>void)=>listeners.delete(fn)}));const {result,unmount}=renderHook(()=>useReducedMotion());expect(result.current).toBe(false);act(()=>{reduced=true;listeners.forEach(fn=>fn())});expect(result.current).toBe(true);act(()=>{reduced=false;listeners.forEach(fn=>fn())});expect(result.current).toBe(false);unmount();expect(listeners.size).toBe(0)})
