import {cloneElement,isValidElement,createContext,useContext,useEffect,useRef,useState,type ComponentProps} from 'react'
import {Dialog} from 'radix-ui'
import {FgButton} from '@/components/fg/primitives'
import {Fridge} from './Fridge'
import {FridgeIntake} from './FridgeIntake'
import {useFridgeMedia} from './FridgeMedia'
import {FridgeGoalsEditor,FridgeNotesEditor,GoalForm} from './FridgeEditing'
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
 return <><div inert={enabled&&!!service&&state.kind==='loading'}><Fridge {...fridge}/></div><div className="fridge-phase2-state" role={error?'alert':'status'}>{text}{enabled&&service&&error&&state.kind!=='authentication'&&<FgButton variant="secondary" onClick={()=>setRetry(n=>n+1)}>Retry editing check</FgButton>}</div></>
}
function Ready({fridge,viewer,service}:Omit<Props,'enabled'> & {service:Phase2Service}){
 const editing=useFridgeEditing(service.adapter,fridge.childId,viewer)
 const notes=editing.notes.kind==='ready'?editing.notes.items:[]
 const media=useFridgeMedia(notes)
 const [inlineGoal,setInlineGoal]=useState(false)
 const [section,setSection]=useState<'goals'|'notes'|null>(null)
 const editorOpener=useRef<HTMLElement|null>(null)
 const openSection=(next:'goals'|'notes')=>{editorOpener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setSection(next)}
 // Phase 1's whiteboard stays independently readable even if a Phase 2 read fails.
 const goalsOverride:Read<Goal[]>|undefined=editing.goals.kind==='ready'?(editing.goals.items.length?{status:'ready',value:editing.goals.items}:{status:'empty'}):undefined
 return <><Fridge {...fridge}
 intake={isValidElement<ComponentProps<typeof FridgeIntake>>(fridge.intake)&&fridge.intake.type===FridgeIntake?cloneElement(fridge.intake,{onPinned:()=>editing.retry()}):fridge.intake}
 mediaUrls={media}
 captionNotes={notes.filter(note=>note.attachmentRef?.startsWith('fridge-art:'))}
 saveCaption={editing.canWrite&&editing.notes.kind==='ready'?async(slot,text)=>{
  const existing=notes.find(note=>note.attachmentRef===`fridge-art:${slot.id}`||note.id===slot.id)
  return existing?editing.updateNote(existing.id,{text,paperColor:existing.paperColor}):editing.postNote({text,paperColor:'WHITE',attachmentRef:`fridge-art:${slot.id}`})
 }:undefined}
 boardEditor={editing.canWrite&&editing.goals.kind==='ready'?<>
  <FgButton disabled={editing.pending!==null} onClick={()=>{if(window.matchMedia('(max-width: 700px)').matches)openSection('goals');else setInlineGoal(value=>!value)}}>Write on the whiteboard</FgButton>
  {inlineGoal&&<><GoalForm label="Write a goal on the whiteboard" pending={editing.pending==='goals'} onSave={async fields=>{const saved=await editing.createGoal(fields);if(saved)setInlineGoal(false);return saved}} onCancel={()=>setInlineGoal(false)}/>{editing.notice?.section==='goals'&&<p role={editing.notice.kind==='failed'?'alert':'status'}>{editing.notice.text}</p>}<FgButton variant="quiet" onClick={()=>{setInlineGoal(false);openSection('goals')}}>Open full-size editor</FgButton></>}
 </>:undefined}
 postedNotes={notes.filter(note=>!note.attachmentRef?.startsWith('fridge-art:'))} openPostedNotes={()=>openSection('notes')} goalsOverride={goalsOverride} boardReadOnly={!editing.canWrite} editingControls={<>
  {section===null&&!inlineGoal&&editing.notice?.section==='goals'&&<p role={editing.notice.kind==='failed'?'alert':'status'}>{editing.notice.text}</p>}
  {editing.canWrite&&editing.notes.kind==='ready'&&<FgButton disabled={editing.pending!==null} onClick={()=>openSection('notes')}>Add sticky note</FgButton>}
  <FgButton variant="secondary" disabled={editing.pending!==null} onClick={()=>openSection('goals')}>{editing.canWrite?'Manage goals':'Goal details'}</FgButton>
  <FgButton variant="secondary" disabled={editing.pending!==null} onClick={()=>openSection('notes')}>Family notes{editing.notes.kind==='ready'?` (${editing.notes.items.length})`:''}</FgButton>
 </>}/>
 <Dialog.Root open={section!==null} onOpenChange={open=>{if(!open)setSection(null)}}><Dialog.Portal><Dialog.Overlay className="fridge-overlay"/><Dialog.Content className="fridge-dialog fridge-editor-dialog" onCloseAutoFocus={event=>{event.preventDefault();editorOpener.current?.focus()}}><div className="fridge-editor-heading"><div><Dialog.Title>{section==='goals'?'Whiteboard':'Family notes'}</Dialog.Title><Dialog.Description>{editing.canWrite?'Review your changes before saving.':viewer.role==='GUIDE'?'Demo guide is read-only.':'Read-only perspective.'}</Dialog.Description></div><Dialog.Close className="fridge-editor-close" aria-label="Close editor">Close</Dialog.Close></div>{section==='goals'?<FridgeGoalsEditor editing={editing}/>:<FridgeNotesEditor editing={editing} viewer={viewer}/>}</Dialog.Content></Dialog.Portal></Dialog.Root></>
}
