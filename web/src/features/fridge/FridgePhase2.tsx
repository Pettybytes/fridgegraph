import {createContext,useContext,useEffect,useState,type ComponentProps} from 'react'
import {Dialog} from 'radix-ui'
import {FgButton} from '@/components/fg/primitives'
import {Fridge} from './Fridge'
import {FridgeGoalsEditor,FridgeNotesEditor} from './FridgeEditing'
import {useFridgeEditing} from './useFridgeEditing'
import type {FridgeViewer} from './editingContract'
import {phase2Message,type Compatibility,type Phase2Service} from './phase2Adapter'
import type {Goal,Read} from './model'

// Evidence-only dependency injection. Production provides its existing Apollo client.
export type Phase2PreviewFactory=(viewer:FridgeViewer,childId:string)=>Phase2Service
export const FridgePhase2Preview=createContext<Phase2PreviewFactory|null>(null)
export const usePhase2Preview=()=>useContext(FridgePhase2Preview)
type Props={fridge:ComponentProps<typeof Fridge>;viewer:FridgeViewer;service:Phase2Service|null;enabled:boolean}
export function FridgePhase2(props:Props){return <Boundary key={`${props.viewer.sessionKey}:${props.viewer.personId}:${props.viewer.role}:${props.fridge.childId}`} {...props}/>}
function Boundary({fridge,viewer,service,enabled}:Props){
 const [state,setState]=useState<Compatibility|{kind:'loading'}>({kind:'loading'}),[retry,setRetry]=useState(0)
 useEffect(()=>{if(!enabled||!service)return;const abort=new AbortController();setState({kind:'loading'});void service.check(fridge.childId,abort.signal).then(next=>{if(!abort.signal.aborted)setState(next)},()=>{if(!abort.signal.aborted)setState({kind:'failed'})});return()=>abort.abort()},[service,enabled,fridge.childId,retry])
 if(enabled&&service&&state.kind==='ready')return <Ready fridge={fridge} viewer={viewer} service={service}/>
 const error=state.kind!=='loading'&&state.kind!=='absent'&&state.kind!=='ready'
 const text=!enabled?'Editing is not enabled yet.':!service?'Choose a live perspective to check editing.':state.kind==='loading'?'Checking editing compatibility…':state.kind==='absent'?'Editing isn’t available on this version. The fridge is read-only.':state.kind in phase2Message?phase2Message[state.kind as keyof typeof phase2Message]:''
 return <><Fridge {...fridge}/><div className="fridge-phase2-state" role={error?'alert':'status'}>{text}{enabled&&service&&error&&state.kind!=='authentication'&&<FgButton variant="secondary" onClick={()=>setRetry(n=>n+1)}>Retry editing check</FgButton>}</div></>
}
function Ready({fridge,viewer,service}:Omit<Props,'enabled'> & {service:Phase2Service}){
 const editing=useFridgeEditing(service.adapter,fridge.childId,viewer)
 const [section,setSection]=useState<'goals'|'notes'|null>(null)
 // Phase 1's whiteboard stays independently readable even if a Phase 2 read fails.
 const goalsOverride:Read<Goal[]>|undefined=editing.goals.kind==='ready'?(editing.goals.items.length?{status:'ready',value:editing.goals.items}:{status:'empty'}):undefined
 return <><Fridge {...fridge} postedNotes={editing.notes.kind==='ready'?editing.notes.items:[]} openPostedNotes={()=>setSection('notes')} goalsOverride={goalsOverride} boardReadOnly={!editing.canWrite} editingControls={<>
  <FgButton variant="secondary" disabled={editing.pending!==null} onClick={()=>setSection('goals')}>{editing.canWrite?'Manage goals':'Goal details'}</FgButton>
  <FgButton variant="secondary" disabled={editing.pending!==null} onClick={()=>setSection('notes')}>Family notes{editing.notes.kind==='ready'?` (${editing.notes.items.length})`:''}</FgButton>
 </>}/>
 <Dialog.Root open={section!==null} onOpenChange={open=>{if(!open)setSection(null)}}><Dialog.Portal><Dialog.Overlay className="fridge-overlay"/><Dialog.Content className="fridge-dialog fridge-editor-dialog"><div className="fridge-editor-heading"><div><Dialog.Title>{section==='goals'?'Whiteboard':'Family notes'}</Dialog.Title><Dialog.Description>{editing.canWrite?'Review your changes before saving.':viewer.role==='GUIDE'?'Demo guide is read-only.':'Read-only perspective.'}</Dialog.Description></div><Dialog.Close className="fridge-editor-close" aria-label="Close editor">Close</Dialog.Close></div>{section==='goals'?<FridgeGoalsEditor editing={editing}/>:<FridgeNotesEditor editing={editing} viewer={viewer}/>}</Dialog.Content></Dialog.Portal></Dialog.Root></>
}
