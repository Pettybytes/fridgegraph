const channelName='fridgegraph-calendar-changed'
const source=crypto.randomUUID()
/** Invalidation only: no identities, event contents, or authority cross this channel. */
export function notifyCalendarChanged(){
 window.dispatchEvent(new Event('frontend:changed'))
 if(typeof BroadcastChannel==='undefined')return
 try{
  const channel=new BroadcastChannel(channelName)
  try{channel.postMessage({type:'changed',source})}finally{channel.close()}
 }catch{/* Storage restrictions must not turn a successful save into an apparent failure. */}
}
export function subscribeCalendarChanges(){
 if(typeof BroadcastChannel==='undefined')return()=>{}
 try{
  const channel=new BroadcastChannel(channelName)
  channel.onmessage=event=>{
   if(event.data?.type==='changed'&&event.data.source!==source)window.dispatchEvent(new Event('frontend:changed'))
  }
  return()=>channel.close()
 }catch{return()=>{}}
}
