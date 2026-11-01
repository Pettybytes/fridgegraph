import {useEffect} from 'react'
import type {OrbitController} from './controller'
/** Recorded active workflows only; no idle discovery, concurrent requests or identity renewal. */
export function useActivePolling(controller:OrbitController,active:boolean){
 useEffect(()=>{
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,flight=false,delay=2000
  const visible=()=>document.visibilityState!=='hidden'
  async function tick(){
   if(stopped||flight||!visible()||controller.getSnapshot().phase!=='active')return
   flight=true
   try{await controller.refresh();delay=controller.getSnapshot().error?Math.min(delay*2,16000):2000}
   catch{delay=Math.min(delay*2,16000)}
   finally{flight=false;if(!stopped&&visible()&&controller.getSnapshot().phase==='active')timer=setTimeout(tick,delay)}
  }
  function visibility(){clearTimeout(timer);if(document.visibilityState!=='hidden'&&active)void tick()}
  if(active&&document.visibilityState!=='hidden')timer=setTimeout(tick,delay)
  document.addEventListener('visibilitychange',visibility)
  return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility)}
 },[controller,active])
}
