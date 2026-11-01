import {useSyncExternalStore} from 'react'
const query='(prefers-reduced-motion: reduce)'
function subscribe(notify:()=>void){if(typeof matchMedia!=='function')return()=>{};const media=matchMedia(query);media.addEventListener('change',notify);return()=>media.removeEventListener('change',notify)}
// Updates existing workflows when the preference changes, not only at mount.
export function useReducedMotion(){return useSyncExternalStore(subscribe,()=>typeof matchMedia==='function'?matchMedia(query).matches:true,()=>true)}
