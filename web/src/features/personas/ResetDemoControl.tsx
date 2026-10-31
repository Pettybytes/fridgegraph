import {useState} from 'react'
import {Dialog} from 'radix-ui'
import {useSession} from './Session'
import './reset-demo.css'
export function ResetDemoControl(){const {getSessionGeneration}=useSession();return <ResetDialog key={getSessionGeneration()}/>}
function ResetDialog(){
 const {session,authMode,resetting,resetError,resetRetryAt,resetDemo,switching}=useSession(),[open,setOpen]=useState(false)
 if(session?.marks?.demoGuide||session?.persona.id==='demo-guide'||(authMode==='live'&&session?.marks?.demo!==true))return null
 return <>
  <button type="button" disabled={switching||resetting} onClick={()=>setOpen(true)}>Reset demo</button>
  <Dialog.Root open={open} onOpenChange={value=>{if(!resetting)setOpen(value)}}><Dialog.Portal><Dialog.Overlay className="reset-demo-backdrop"/><Dialog.Content className="reset-demo-dialog" data-state={authMode==='live'?'live':'unavailable'} aria-busy={resetting}>
   {authMode==='mock'&&<p className="reset-demo-sample">Sample action</p>}
   <Dialog.Title>Reset the demo village for everyone?</Dialog.Title>
   <Dialog.Description>This clears alerts, responses and changes made by visitors.</Dialog.Description>
   {resetError&&<p className="reset-demo-error" role="alert">{resetError}</p>}
   <div className="reset-demo-actions"><Dialog.Close disabled={resetting}>Cancel</Dialog.Close><button className="reset-demo-confirm" disabled={resetting||Date.now()<resetRetryAt} onClick={()=>{void resetDemo().then(ok=>{if(ok)setOpen(false)})}}>{resetting?'Resetting demo…':'Reset demo for everyone'}</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </>
}
