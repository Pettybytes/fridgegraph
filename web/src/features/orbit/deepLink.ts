/** Destination only. Neither persona nor alert query parameters create a session or confer authority. */
export function orbitDestination(pathname:string,search:string){
 if(pathname!=='/orbit')return null
 const id=new URLSearchParams(search).get('alert')
 return id&&/^[A-Za-z0-9_-]{1,128}$/.test(id)?`#/orbit?alertId=${encodeURIComponent(id)}`:'#/orbit'
}
