import {useEffect,useRef,useState} from 'react'
import {AlertDialog} from 'radix-ui'
import {FgButton} from '@/components/fg/primitives'
import {useSession} from './Session'
import {canResetDemo} from './auth'
import './reset-demo.css'
export function ResetDemoControl(){
 const {getSessionGeneration,notice}=useSession()
 return <><ResetDialog key={getSessionGeneration()}/>{notice&&<p className="reset-demo-toast" role="status">{notice}</p>}</>
}
function ResetDialog(){
 const {session,authMode,resetting,resetError,resetRetryAt,resetDemo,switching,notice}=useSession(),[open,setOpen]=useState(!!resetError),trigger=useRef<HTMLButtonElement>(null)
 useEffect(()=>{if(notice)trigger.current?.focus()},[notice])
 if(!canResetDemo(session?.persona)||(authMode==='live'&&session?.marks?.demo!==true))return null
 return <AlertDialog.Root open={open} onOpenChange={value=>{if(!resetting)setOpen(value)}}>
  <AlertDialog.Trigger asChild><FgButton ref={trigger} className="reset-demo-trigger" variant="ghost" disabled={switching||resetting}>Reset demo</FgButton></AlertDialog.Trigger>
  <AlertDialog.Portal><AlertDialog.Overlay className="reset-demo-backdrop"/><AlertDialog.Content className="reset-demo-dialog" data-mode={authMode==='live'?'live':'unavailable'} aria-busy={resetting}>
   <AlertDialog.Title>Reset the demo village for everyone?</AlertDialog.Title>
   <AlertDialog.Description>This clears alerts, responses and changes made by visitors.{authMode==='mock'?' Sample action.':''}</AlertDialog.Description>
   {resetError&&<p className="reset-demo-error" role="alert">{resetError}</p>}
   <div className="reset-demo-actions"><AlertDialog.Cancel asChild><FgButton variant="secondary" disabled={resetting}>Cancel</FgButton></AlertDialog.Cancel><FgButton className="reset-demo-confirm" aria-busy={resetting} disabled={resetting||Date.now()<resetRetryAt} disabledReason="Wait a moment before resetting again" onClick={()=>{void resetDemo().then(ok=>{if(ok)setOpen(false)})}}>{resetting?'Resetting demo…':'Reset demo for everyone'}</FgButton></div>
  </AlertDialog.Content></AlertDialog.Portal>
 </AlertDialog.Root>
}
