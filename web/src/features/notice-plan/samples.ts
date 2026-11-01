import sampleText from './samples/notice-a-early-dismissal.txt?raw'
// Exact assets from Claude Code's 9103559, not newly authored notices.
export {sampleText}
export async function sampleFile(signal:AbortSignal){
 const response=await fetch('/samples/notice-plan/notice-a-early-dismissal.png',{signal,cache:'no-store'})
 if(!response.ok)throw Error('Sample unavailable')
 return new File([await response.arrayBuffer()],'notice-a-early-dismissal.png',{type:'image/png'})
}
export async function isEarlyDismissalSample(kind:'image'|'pdf',dataBase64:string){
 const bytes=Uint8Array.from(atob(dataBase64),c=>c.charCodeAt(0))
 const digest=await crypto.subtle.digest('SHA-256',bytes)
 const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
 return hash===(kind==='image'?'6c61f1efc8f7d6767b2a1e198829155431953951bcbafffd27f78382c1f14b69':'b8842dc8e72bc81823b3cb911ab8d53b3edb941d06f4a9e09868bcf13789e6a9')
}
