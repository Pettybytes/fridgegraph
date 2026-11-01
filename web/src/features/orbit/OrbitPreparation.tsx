import {useState} from 'react'
import {ArrowRight,Upload} from 'lucide-react'
import {descriptorKeys,vocabularyKinds} from './adapter'
import {useOrbitPhoto,useOrbitState} from './runtime'
import type {OrbitController} from './controller'
import {midnight,addDays,formatTime} from '@/features/calendar/time'
export const descriptorLabels={wearColor:'Clothing color',wearGarment:'Clothing',hair:'Hair',carryColor:'Carrying color',carryItem:'Carrying'}
/** Detroit wall time can identify zero, one or two instants. Never guess through DST. */
export function detroitInstants(value:string){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return []
 const [day,time]=value.split('T'),format=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Detroit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),found:string[]=[]
 try{for(let instant=midnight(day);instant<midnight(addDays(day,1));instant+=60000)if(format.format(new Date(instant))===time)found.push(new Date(instant).toISOString())}catch{return []}return found
}
export function OrbitPreparation({controller}:{controller:OrbitController}){
 const state=useOrbitState(controller),image=useOrbitPhoto(controller,state.busy==='upload'?undefined:state.photoId),[wallTime,setWallTime]=useState('')
 const choices=detroitInstants(wallTime)
 return <div className="orbit-preparation">
  <section className="orbit-details"><h2>Review what to share</h2><p>Confirm or edit the description. Only these details enter the preview.</p>
   {state.busy==='upload'&&<p role="status">Preparing the shared photo…</p>}{state.suggestionNotice&&<p role="status">{state.suggestionNotice}</p>}
   {image.url&&<img className="orbit-photo" src={image.url} alt="Parent's shared photo" onError={image.onError}/>}{image.failed&&<p>Couldn't display the shared photo.</p>}
   <fieldset disabled={!!state.busy}><legend className="sr-only">Message description</legend>{descriptorKeys.map(key=><label key={key}>{descriptorLabels[key]}<select aria-label={descriptorLabels[key]} value={state.values[key]??''} onChange={e=>controller.edit(key,e.target.value)}><option value="">Not specified</option>{state.vocabulary.filter(v=>v.kind===vocabularyKinds[key]).map(v=><option key={v.value} value={v.value}>{v.value.replaceAll('_',' ')}</option>)}</select></label>)}
    <label>Last known place<select value={state.lastSeen.lastSeenPlaceId??''} onChange={e=>controller.setLastSeen('lastSeenPlaceId',e.target.value)}><option value="">Choose a recorded place</option>{state.places.map(place=><option key={place.id} value={place.id}>{place.label}</option>)}</select></label>
    {state.placesError&&<p role="alert">{state.placesError}</p>}{!state.placesError&&!state.places.length&&<p>No recorded places are available to this view.</p>}
    <label>Last seen time (Detroit)<input type="datetime-local" value={wallTime} onChange={e=>{const value=e.target.value;setWallTime(value);const matches=detroitInstants(value);controller.setLastSeen('lastSeenAt',matches.length===1?matches[0]:'')}}/></label>
    {wallTime&&choices.length===0&&<p role="alert">That Detroit time does not exist. Choose another time.</p>}
    {choices.length>1&&<label>Which occurrence?<select value={state.lastSeen.lastSeenAt??''} onChange={e=>controller.setLastSeen('lastSeenAt',e.target.value)}><option value="">Choose the recorded time</option>{choices.map(at=><option key={at} value={at}>{formatTime(at,true)}</option>)}</select></label>}
    <label className="orbit-upload">{state.photoId?'Replace photo':'Add a photo (optional)'}<input type="file" accept="image/jpeg,image/png" onChange={e=>{const file=e.target.files?.[0];if(file)void (state.photoFlow?controller.startPhoto(file):controller.upload(file));e.target.value=''}}/></label>
   </fieldset>
   {!state.preview&&<button className="orbit-primary" disabled={!!state.busy||(state.photoFlow&&(!state.lastSeen.lastSeenPlaceId||!state.lastSeen.lastSeenAt))} onClick={()=>{void controller.review()}}>{state.busy==='preview'?'Preparing your preview…':'Review message'} <ArrowRight size={16}/></button>}
  </section>
  <section className="orbit-message fg-glass" aria-label="Message preview"><span className="orbit-message-label">{controller.confirmable()?"Here's the exact preview":state.busy==='preview'?'Preparing…':'Preview not ready'}</span>{state.preview?<><blockquote>{state.preview.message}</blockquote><p className="orbit-audience">Your approved village ({state.preview.audienceSize} people) will be notified.</p><button className="orbit-primary" disabled={!controller.confirmable()} onClick={()=>{void controller.activate()}}>{state.phase==='activating'?'Activating…':'Confirm and activate Orbit'}</button></>:<><h2>Review before you share.</h2><p>{state.busy==='preview'?'Your exact message is being prepared.':'Review the updated message before confirming.'}</p><button className="orbit-primary" disabled>Confirm and activate Orbit</button></>}</section>
 </div>
}
export function OrbitPhotoChat({controller}:{controller:OrbitController}){
 const state=useOrbitState(controller)
 if(!state.authority||controller.scope.readOnly)return null
 const upload=(file:File|undefined)=>{if(file)void controller.startPhoto(file)}
 if(state.alert?.status==='ACTIVE'||state.alert?.status==='CLOSED')return state.photoFlow?<a className="orbit-primary" href="#/orbit">View Orbit Alert</a>:null
 return <section className="orbit-chat-flow" aria-label="Prepare an Orbit Alert">
  <div className="orbit-photo-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();upload(e.dataTransfer.files[0])}}><Upload size={24}/><h3>Start an Orbit Alert with a photo</h3><p>Drop a photo here or choose one. You review every detail before sharing.</p>{state.phase==='loading'&&<p role="status">Loading shared Orbit records…</p>}<label>Choose photo<input type="file" disabled={!controller.canPrepare()} accept="image/jpeg,image/png" onChange={e=>{upload(e.target.files?.[0]);e.target.value=''}}/></label></div>
  {state.photoFlow&&<>{state.guidance&&<p className="orbit-guidance">{state.guidance}</p>}{state.error&&<p role="alert">{state.error}</p>}<OrbitPreparation controller={controller}/></>}
 </section>
}
