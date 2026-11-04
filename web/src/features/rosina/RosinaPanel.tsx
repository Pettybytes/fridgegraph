import {onEnterSubmit, COMPOSER_HINT_MULTILINE} from '@/lib/composerKeys'
import {NoticeComposer} from '@/features/notice-plan/NoticeComposer'
import {RosinaVoiceButton} from '@/features/voice/RosinaVoiceButton'
import {useOrbit,useOrbitState} from '@/features/orbit/runtime'
import type {OrbitController} from '@/features/orbit/controller'
import { useCalendarActionScope } from '@/features/calendar/useCalendarActionScope'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent, ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { MessageCircle, X, ArrowUp } from 'lucide-react'
import { useSession } from '@/features/personas/Session'
import { useChildAccess } from '@/features/personas/childContext'
import type { ChatMessage, FrontendAdapter } from '@/lib/frontendData/types'
import { actionAllowed, actionLabel, actionRoute, catalog, validateActions } from './catalog'
import type { CatalogAction, ExplainableScreen } from './catalog'
import { createLiveRosinaAdapter, LIVE_FALLBACK, RosinaCancelled } from './liveAdapter'
import { createMockRosinaAdapter } from './adapter'
import type { RosinaAdapter, RosinaResponse } from './adapter'
import { SchoolReportCard } from './SchoolReportCard'
import { createLiveSchoolReportConfirm, createMockSchoolReportConfirm, parseSchoolReportProposal } from './schoolReport'
import type { ConfirmSchoolReport, SchoolReportProposal } from './schoolReport'
import type {RosinaProgress} from './liveAdapter'
import {AddVillagerReview} from '@/features/add-villager/AddVillagerReview'
import {parseAddVillagerProposal} from '@/features/add-villager/addVillager'
import type {AddVillagerProposal} from '@/features/add-villager/addVillager'
import {RosinaAvatar} from '@/components/fg/RosinaAvatar'
import {FgButton} from '@/components/fg/primitives'
import './rosina.css'
type ThreadMessage = ChatMessage & { actions: CatalogAction[]; schoolReportProposal?: SchoolReportProposal | null; addVillagerProposal?: AddVillagerProposal | null }
type PanelProps={contextCard?:ReactNode;dataAdapter?:FrontendAdapter;service?:RosinaAdapter;confirmSchoolReport?:ConfirmSchoolReport}
export function RosinaPanel(props:PanelProps){
  const {session,getSessionGeneration}=useSession()
  const child = useChildAccess()
  return <PersonaRosinaPanel key={`${session?.generation??`signed-out:${getSessionGeneration()}`}:${child?.selectedChildId??session?.scope.childId??''}`} {...props}/>
}
function PersonaRosinaPanel(props:PanelProps){const orbit=useOrbit();return orbit?<ConnectedOrbitPanel {...props} orbit={orbit}/>:<RosinaConversation {...props}/> }
function ConnectedOrbitPanel(props:PanelProps&{orbit:OrbitController}){useOrbitState(props.orbit);return <RosinaConversation {...props}/> }
function RosinaConversation({dataAdapter,service,orbit,contextCard,confirmSchoolReport}:PanelProps&{orbit?:OrbitController}){
  const { session, registerPrivateCleanup, getSessionGeneration, renewSession, authMode } = useSession()
  const child = useChildAccess()
  const calendarScope = useCalendarActionScope(session?.persona.personId)
  const [progress,setProgress]=useState<RosinaProgress>('sending')
  const [elapsed,setElapsed]=useState(0)
  // Provisional streamed reply: token text and the latest status label while a turn runs.
  // The resolved response is authoritative and replaces it (identical text in the normal case).
  const [liveStream,setLiveStream]=useState<{text:string;status:string|null}|null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const adapter = useMemo(() => service ?? (session?.accessToken
    ? createLiveRosinaAdapter(() => sessionRef.current?.accessToken, {getGeneration:getSessionGeneration,onProgress:setProgress,
      onToken:text=>setLiveStream(prev=>({text:(prev?.text??'')+text,status:null})),
      onStatus:label=>setLiveStream(prev=>({text:prev?.text??'',status:label})),
      onReplace:()=>setLiveStream({text:'',status:null})})
    : createMockRosinaAdapter(session, dataAdapter)), [session, dataAdapter, service, getSessionGeneration])
  const confirmReport = useMemo(() => confirmSchoolReport ?? (adapter.mode === 'mock' ? createMockSchoolReportConfirm() : child?.client ? createLiveSchoolReportConfirm(child.client) : null), [confirmSchoolReport, adapter.mode, child?.client])
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(() => location.hash.startsWith('#/ask-rosina'))
  const [focusMicRequest,setFocusMicRequest]=useState(0)
  const [dismissed,setDismissed] = useState(false)
  const [needsSignIn,setNeedsSignIn] = useState(false)
  const requestId=useRef(0)
  const [currentRoute, setCurrentRoute] = useState(location.hash)
  const [busy, setBusy] = useState(false)
  useEffect(()=>{if(!busy){setElapsed(0);return}const started=Date.now();const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer)},[busy])
  const [error, setError] = useState('')
  const [people, setPeople] = useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = useState<{ action: CatalogAction; key: string } | null>(null)
  const nextId = useRef(0), active = useRef(true), abort = useRef<AbortController | null>(null)
  const threadRef = useRef<HTMLDivElement>(null), launcherRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null), focusMicOnOpen = useRef(false)
  const askFromToday = useRef<(message:string)=>void>(()=>{})
  const sent = useRef(false), executed = useRef(new Set<string>())
  const context = { ...calendarScope, canPrepareOrbit:orbit?.canPrepare()??false, readOnly: session?.marks?.demoGuide===true, childId: session?.scope.childId ?? null, parent: session?.persona.parent ?? false, visiblePeople: people, canReadCare: !!session && (session.persona.parent || session.persona.grants.includes('careplan.read')) }
  useEffect(() => {
    active.current = true
    const unregister = registerPrivateCleanup(() => {
      active.current = false; ++requestId.current; abort.current?.abort(); sent.current = false
      setMessages([]); setDraft(''); setPending(null); setOpen(false); setPeople(new Set()); executed.current.clear()
    })
    return () => { active.current = false; ++requestId.current; abort.current?.abort(); unregister() }
  }, [registerPrivateCleanup])
  useEffect(() => {
    let current = true
    if (session && dataAdapter) dataAdapter.readVillage(session.scope).then(data => { if (current) setPeople(new Set(data.nodes.map(node => node.person.id))) }, () => { if (current) setPeople(new Set()) })
    return () => { current = false }
  }, [session, dataAdapter])
  // Warm Rosina on page load (latency playbook 6): primes the caller's context + lens caches and
  // the model connection so the FIRST question streams fast. Fire-and-forget, auth'd, read-only.
  useEffect(() => {
    const token = session?.accessToken
    if (adapter.mode !== 'live' || !token) return
    void fetch('/api/rosina/warm', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
  }, [adapter.mode, session?.generation, session?.accessToken])
  useEffect(() => {
    if (threadRef.current && (messages.length > 0 || busy)) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [messages, busy, liveStream])
  useEffect(() => {
    const followRoute = () => {
      setCurrentRoute(location.hash)
      if (location.hash.startsWith('#/ask-rosina')) {setOpen(true);setDismissed(false)}
    }
    followRoute()
    window.addEventListener('hashchange', followRoute)
    return () => window.removeEventListener('hashchange', followRoute)
  }, [])
  useEffect(()=>{const reopen=()=>{setOpen(true);setDismissed(false)};window.addEventListener('rosina:open',reopen);return()=>window.removeEventListener('rosina:open',reopen)},[])
  useEffect(()=>{
    const focusMic=()=>{focusMicOnOpen.current=true;setFocusMicRequest(value=>value+1);setOpen(true);setDismissed(false)}
    window.addEventListener('rosina:focus-mic',focusMic)
    return()=>window.removeEventListener('rosina:focus-mic',focusMic)
  },[])
  useEffect(()=>{
    if (!open || !focusMicOnOpen.current) return
    focusMicOnOpen.current=false
    panelRef.current?.querySelector<HTMLButtonElement>('.fg-voice button[aria-label="Start talking to Rosina"]')?.focus()
  },[open,dismissed,focusMicRequest])
  useEffect(()=>{
    const receive=(event:Event)=>{
      const detail=(event as CustomEvent<unknown>).detail
      if (!detail || typeof detail!=='object') return
      const {message,generation,childId}=detail as Record<string,unknown>
      if (typeof message!=='string' || !message.trim() || message.length>4000 || generation!==getSessionGeneration() || childId!==(child?.selectedChildId??sessionRef.current?.scope.childId)) return
      setOpen(true);setDismissed(false)
      askFromToday.current(message.trim())
    }
    window.addEventListener('rosina:send-from-today',receive)
    return()=>window.removeEventListener('rosina:send-from-today',receive)
  },[child?.selectedChildId,getSessionGeneration])
  // Orbit is its own screen now (feat/orbit-alert-motion). Opening Rosina from Orbit no longer
  // prefills a draft — the composer starts empty with a neutral placeholder.
  useEffect(()=>{const prepare=(event:Event)=>{const text=(event as CustomEvent<unknown>).detail;if(typeof text==='string'){setOpen(true);setDismissed(false)}};window.addEventListener('orbit:ask',prepare);return()=>window.removeEventListener('orbit:ask',prepare)},[])
  function append(from: 'PARENT' | 'ROSINA', text: string, actions: CatalogAction[] = [], schoolReportProposal?: SchoolReportProposal | null, addVillagerProposal?: AddVillagerProposal | null) {
    if (!active.current) return
    const message: ThreadMessage = { id: `local-rosina-${++nextId.current}`, from, kind: 'TEXT', text, at: new Date().toISOString(), relatedJobId: null, relatedInformationRequestId: null, hasVoiceNote: false, actions, schoolReportProposal, addVillagerProposal }
    setMessages(items => [...items, message])
  }
  // /voice/turn already ran the turn. Insert its output; never call ask/send here.
  function appendUserMessage(text:string) { append('PARENT',text) }
  function appendRosinaReply(reply:string,actions:unknown[]) { accept({reply,actions}) }
  function accept(response: RosinaResponse) {
    const actions=validateActions(response.actions)
    // Keep validated cards until their live dependencies settle; execution still rechecks permission.
    const orbitOffer=actions.some(action=>action.id==='prepareOrbitAlert')
    append('ROSINA', orbitOffer&&orbit ? 'I can prepare an Orbit message for you to review. Nothing has been activated.' : response.reply, actions, parseSchoolReportProposal(response.schoolReportProposal), parseAddVillagerProposal(response.addVillagerProposal))
  }
  useEffect(()=>{const close=()=>closePanel();window.addEventListener('rosina:close',close);return()=>window.removeEventListener('rosina:close',close)},[])
  function closePanel() {
    ++requestId.current; abort.current?.abort(); abort.current=null; sent.current=false
    setBusy(false);setError('');setPending(null);setOpen(false);setDismissed(true);setLiveStream(null)
    if (location.hash.startsWith('#/ask-rosina')) location.hash = '#/today'
  }
  async function ask(message:string, recordUser=true) {
    if (!message || sent.current || needsSignIn) return
    const generation=getSessionGeneration(),id=++requestId.current,controller=new AbortController()
    abort.current=controller
    const owns=()=>active.current && getSessionGeneration()===generation && requestId.current===id && !controller.signal.aborted
    sent.current=true;setProgress('sending');setBusy(true);setError('');setLiveStream(null)
    const history=messages.slice(-40).map(item=>({role:item.from==='PARENT'?'user' as const:'assistant' as const,content:item.text??''}))
    if(recordUser)append('PARENT',message)
    try {
      const response=await adapter.send({message,currentRoute:location.hash||'#/mission-control',history},controller.signal)
      if(owns()){if(response.notice==='sign-in'){setNeedsSignIn(true);const renewed=await renewSession();if(owns()&&renewed){setNeedsSignIn(false);append('ROSINA','Your perspective is ready again. Please send your question again.')}else if(owns()){if(authMode==='live'){setNeedsSignIn(false);append('ROSINA','Busy, try again in a moment')}else accept(response)}}else accept(response)}
    }catch(error){
      if(owns() && !(error instanceof RosinaCancelled)) {
        if(adapter.mode==='live')append('ROSINA',LIVE_FALLBACK)
        else setError('Rosina could not reply. Try again. Your message was not submitted as an action.')
      }
    }finally{if(owns()){setBusy(false);sent.current=false;abort.current=null;setLiveStream(null)}}
  }
  askFromToday.current=(message:string)=>{
    if (sent.current || needsSignIn) { setDraft(message); return }
    void ask(message)
  }
  // One guarded submit path for both the form (button / Enter) — empty and whitespace-only do
  // nothing; a turn already in flight (sent.current) or a pending re-auth blocks another submission
  // and leaves the draft untouched so it is preserved.
  function submitDraft(){const message=draft.trim();if(!message||sent.current||needsSignIn)return;setDraft('');void ask(message)}
  function send(event:FormEvent){event.preventDefault();submitDraft()}
  function explanation(screen: ExplainableScreen): string {
    if (screen === 'calendar') return 'Family Calendar shows scheduled commitments and care in Detroit time. A schedule is not a confirmed location, and a gap in busy time is not confirmed availability.'
    if (screen === 'care-information') return 'This screen shows care information the family has shared with you. The care plan is named beneath the note.'
    if (screen === 'ask-rosina') return 'You can ask about your village here. Replies use what is shared with you, and every change needs your confirmation.'
    if (screen === 'village') return 'Living Village shows the people and relationships shared with you. Seeing a person here does not give access to their private information.'
    if (session?.persona.guardian) return 'This demo view is not connected for this family yet. Family Calendar shows the plans shared with your guardian role.'
    if (session && !session.persona.parent) return `Pickup plans are shared with ${session.scope.childName.split(' ')[0]}'s parents. You can ask what information is shared with your role.`
    return 'Mission Control shows recorded pickup plans. A caregiver saying yes, a parent approving and a completed pickup are separate facts.'
  }
  async function execute(action: CatalogAction, key: string, confirmed = false) {
    if (!active.current || !validateActions([action]).length || !actionAllowed(action, context) || executed.current.has(key)) return
    // Orbit has its own dedicated screen now; Rosina only deep-links there, never renders Orbit UI in the panel.
    if(action.id==='prepareOrbitAlert'){if(!orbit?.canPrepare())return;executed.current.add(key);closePanel();location.hash='#/orbit';return}
    if (catalog[action.id].changesData && !confirmed) { setPending({ action, key }); return }
    if (catalog[action.id].changesData) {
      executed.current.add(key); setPending(null)
      append('ROSINA', adapter.mode === 'mock' ? 'Your demo request has been reviewed. No pickup was arranged and nobody was contacted.' : 'Pickup requests aren’t available here yet. Nothing was changed.')
      return
    }
    const route = actionRoute(action)
    if (route) { location.hash = route; closePanel(); return }
    if (action.id === 'explain-screen') {
      append('ROSINA', explanation(action.args.screen))
    }
    if (action.id === 'explain-recommendation') {
      await ask('Why was this caregiver recommended?',false)
    }
  }
  const screen: ExplainableScreen = currentRoute.startsWith('#/calendar') ? 'calendar' : currentRoute.startsWith('#/village') ? 'village' : currentRoute.startsWith('#/care-information') ? 'care-information' : currentRoute.startsWith('#/ask-rosina') ? 'ask-rosina' : 'mission-control'
  const focusedChildId = child?.selectedChildId ?? session?.scope.childId
  const latestReport = [...messages].reverse().find(message => message.schoolReportProposal)?.schoolReportProposal
  const reportAccessLoading = adapter.mode === 'live' && child?.authorized.status === 'loading'
  const mayReport = (proposal:SchoolReportProposal) => !!session && !session.marks?.demoGuide && proposal.childId === focusedChildId &&
    (adapter.mode === 'mock' ? session.persona.grants.includes('school.report') : child?.authorized.status === 'ready' && child.authorized.children.some(item => item.id === proposal.childId && item.scopes.includes('school.report')))
  function reportCard(message:ThreadMessage) {
    const proposal=message.schoolReportProposal
    if(!proposal||proposal!==latestReport)return null
    if(reportAccessLoading)return <p role="status">Checking reporting access…</p>
    if(!mayReport(proposal))return <p role="status">This report proposal is not shared with your role.</p>
    if(!confirmReport)return <p role="status">Confirmation is unavailable right now.</p>
    return <SchoolReportCard proposal={proposal} childName={child?.selectedChildName??session?.scope.childName??'Child'} canConfirm accessLoading={false} mode={adapter.mode} confirm={confirmReport}/>
  }
  const pageTarget = currentRoute.startsWith('#/ask-rosina') ? document.getElementById('rosina-route-slot') : null
  useEffect(() => { if (dismissed && !pageTarget) launcherRef.current?.focus() }, [dismissed, pageTarget])
  const panel = <section ref={panelRef} onKeyDown={event => { if (event.key === 'Escape') closePanel() }} hidden={dismissed} className={`rosina-panel fg-glass ${open ? 'is-open' : ''} ${pageTarget ? 'is-page' : ''}`} aria-label="Ask Rosina" data-state={adapter.mode === 'mock' ? 'unavailable' : 'live'}>
      <header><div className="rosina-identity"><RosinaAvatar state={busy?'thinking':'ready'} size={48}/><div><h2>Ask Rosina</h2><p>FridgeGraph's AI family coordinator</p></div></div><button type="button" aria-label="Close Ask Rosina" onClick={closePanel}><X size={18} /></button></header>
      <p className="rosina-source"><strong className={`rosina-mode mode-${adapter.mode}`}>{adapter.mode==='live'?'Live':'Sample answers'}</strong><span>Conversation clears when you switch person</span></p>
      <div ref={threadRef} className="rosina-thread" role="log" aria-label="Rosina conversation" aria-live="polite">
        {contextCard}
        {!messages.length && <div className="rosina-welcome"><MessageCircle size={28} aria-hidden="true" /><h3>A little help with your village.</h3><p>Ask about what you can see or prepare a request. You confirm every change.</p><button type="button" onClick={() => append('ROSINA', explanation(screen))}>Explain this screen</button></div>}
        {messages.map(message => <article key={message.id} className={`rosina-message ${message.from === 'PARENT' ? 'from-person' : ''}`}><span>{message.from === 'PARENT' ? 'You' : 'Rosina'}</span><p>{message.text}</p>{reportCard(message)}<AddVillagerReview proposal={parseAddVillagerProposal(message.addVillagerProposal)} liveEnabled={import.meta.env.VITE_ADD_VILLAGER_LIVE === 'true'} />{message.actions.filter(action => catalog[action.id].implemented && (actionAllowed(action, context) || (action.id==='prepareOrbitAlert' && !!orbit && !context.readOnly && context.parent && action.args.childId===context.childId && ['loading','unavailable'].includes(orbit.getSnapshot().phase)))).map((action, index) => <button type="button" className="rosina-action" aria-label={actionLabel(action)} key={index} disabled={executed.current.has(`${message.id}:${index}`)||!actionAllowed(action,context)} onClick={() => { void execute(action, `${message.id}:${index}`) }}>{actionLabel(action)}{action.id==='prepareOrbitAlert'&&!actionAllowed(action,context)&&<span role="status" className="rosina-action-status">{orbit?.getSnapshot().phase==='loading'?'Loading shared Orbit records…':"Couldn't load the shared Orbit records. Refresh Orbit to try again."}</span>}</button>)}</article>)}
        {busy && !!liveStream?.text && <article className="rosina-message is-streaming" aria-label="Rosina is replying"><span>Rosina</span><p>{liveStream.text}<span className="rosina-caret" aria-hidden="true"/></p></article>}
        {busy && !liveStream?.text && <div className="rosina-progress" role="status"><strong><span className="rosina-typing" aria-hidden="true"><i/><i/><i/></span>{adapter.mode==='live'?(liveStream?.status??(progress==='sending'?'Sending your question…':progress==='waiting'?'Waiting for Rosina’s reply…':'Reading Rosina’s reply…')):'Rosina is preparing a reply…'}</strong><span>{elapsed}s elapsed · You can close this panel to stop waiting.</span></div>}
        {busy && !!liveStream?.text && !!liveStream.status && <p className="rosina-progress-inline" role="status">{liveStream.status}</p>}
      </div>
      {error && <p className="rosina-error" role="alert">{error}</p>}
      <form onSubmit={send} className="rosina-compose"><label htmlFor="rosina-message" className="sr-only">Message Rosina</label>{!dismissed&&<div className="rosina-compose-tools"><RosinaVoiceButton onTranscript={appendUserMessage} onReply={appendRosinaReply} getHistory={()=>messages.slice(-40).map(item=>({role:item.from==='PARENT'?'user' as const:'assistant' as const,content:item.text??''}))}/><div className="rosina-notice-attach"><NoticeComposer/></div></div>}<div className="rosina-field"><textarea id="rosina-message" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onEnterSubmit(submitDraft)} aria-describedby="rosina-composer-hint" maxLength={4000} rows={1} placeholder="Message Rosina…" /><button type="submit" className="rosina-send" aria-label="Send" disabled={busy || needsSignIn || !draft.trim()}><ArrowUp size={18} aria-hidden /></button></div><span id="rosina-composer-hint" className="sr-only">{COMPOSER_HINT_MULTILINE}</span></form>
    </section>
  return <>
    {!pageTarget && <FgButton ref={launcherRef} className={`rosina-launcher ${dismissed ? 'is-reopen' : ''}`} onClick={() => {setOpen(true);setDismissed(false)}} aria-expanded={open}><MessageCircle size={18} aria-hidden="true" />Ask Rosina</FgButton>}
    {pageTarget ? createPortal(panel, pageTarget) : panel}
    <Dialog.Root open={!!pending} onOpenChange={value => { if (!value) setPending(null) }}><Dialog.Portal><Dialog.Overlay className="rosina-confirm-overlay" /><Dialog.Content className="rosina-confirm"><Dialog.Title>Confirm pickup request</Dialog.Title><Dialog.Description>Review the child, date and window. {adapter.mode === 'mock' ? 'This is a demo request. It doesn’t arrange a pickup.' : 'Pickup requests aren’t available here yet.'}</Dialog.Description>{pending?.action.id === 'start-pickup' && <dl><dt>Child</dt><dd>{session?.scope.childName}</dd><dt>Date</dt><dd>{pending.action.args.date}</dd><dt>Window</dt><dd>{pending.action.args.window}</dd></dl>}<button type="button" onClick={() => { if (pending) void execute(pending.action, pending.key, true) }}>Confirm {adapter.mode === 'mock' ? 'demo ' : ''}pickup request</button><Dialog.Close>Cancel</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>
}
