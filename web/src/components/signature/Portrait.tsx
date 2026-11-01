import {useState} from 'react'
/** Supplied fictional art only. A missing/failed mapped asset honestly falls back to initials. */
export function Portrait({name,src}:{name:string;src?:string}){
 const [failed,setFailed]=useState<string|null>(null)
 const initials=name.trim().split(/\s+/).map(part=>part[0]).filter(Boolean).slice(0,2).join('')||'?'
 return <span className="sg-portrait" aria-hidden="true">{src&&failed!==src?<img src={src} alt="" loading="eager" decoding="async" onError={()=>setFailed(src)}/>:<span className="sg-monogram">{initials}</span>}</span>
}
