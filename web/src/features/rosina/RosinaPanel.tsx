import {CalendarChangeCard} from './CalendarChangeCard'
import {onEnterSubmit, COMPOSER_HINT_MULTILINE} from '@/lib/composerKeys'
import {NoticeComposer} from '@/features/notice-plan/NoticeComposer'
import {RosinaVoiceButton} from '@/features/voice/RosinaVoiceButton'
import {useOrbit,useOrbitState} from '@/features/orbit/runtime'
import type {OrbitController} from '@/features/orbit/controller'
import { useCalendarActionScope } from '@/features/calendar/useCalendarActionScope'
import { fireRosinaWarmIfStale, useRosinaWarmKeepAlive } from './warm'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent, ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { MessageCircle, X, ArrowUp } from 'lucide-react'
import { useSession } from '@/features/personas/Session'
import { useChildAccess } from '@/features/personas/childContext'
import type { ChatMessage, FrontendAdapter } from '@/lib/frontendData/types'
import { actionAllowed, actionLabel, actionRoute, catalog, validateActions } from './catalog'
import { pickupStatusLabel } from '@/lib/frontendData/displayCopy'
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
import {Proposals} from './proposals'
import './rosina.css'
type ThreadMessage = ChatMessage & { actions: CatalogAction[]; proposalKeys:string[]; calendarKey?:string; calendarSaved?:boolean; calendarDismissed?:boolean; schoolReportProposal?: SchoolReportProposal | null; addVillagerProposal?: AddVillagerProposal | null }
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
  const [liveStream,setLiveStream]=useState<{text:string;status:string|null;actions:CatalogAction[]}|null>(null)
  const proposals=useRef(new Proposals()), streamTurn=useRef<number|null>(null), confirmation=useRef<string|null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const adapter = useMemo(() => service ?? (session?.accessToken
    ? createLiveRosinaAdapter(() => sessionRef.current?.accessToken, {getGeneration:getSessionGeneration,onProgress:setProgress,
      onToken:(text,turn)=>{if(turn!==streamTurn.current)return;setLiveStream(prev=>({text:(prev?.text??'')+text,status:null,actions:prev?.actions??[]}))},
      onStatus:(label,turn)=>{if(turn!==streamTurn.current)return;setLiveStream(prev=>({text:prev?.text??'',status:label,actions:prev?.actions??[]}))},
      onReplace:turn=>{if(turn!==streamTurn.current)return;if(streamTurn.current!==null)proposals.current.withdraw(streamTurn.current);confirmation.current=null;setPending(null);setLiveStream({text:'',status:null,actions:[]})},
      // A streamed server-validated proposal renders its confirmation card a full model round
      // before the closing text. Client-validated like any resolved action; the resolved
      // response stays authoritative and replaces this provisional card.
      onAction:(raw,turn)=>{if(turn!==streamTurn.current)return;const valid=validateActions([raw]);if(valid.length&&streamTurn.current!==null){const key=proposals.current.offer(streamTurn.current,valid[0]);setLiveStream(prev=>({text:prev?.text??'',status:prev?.status??null,actions:[...(prev?.actions??[]).filter(action=>proposals.current.key(turn!,action)!==key),valid[0]]}))}}})
    : createMockRosinaAdapter(session, dataAdapter)), [session, dataAdapter, service, getSessionGeneration])
  const confirmReport = useMemo(() => confirmSchoolReport ?? (adapter.mode === 'mock' ? createMockSchoolReportConfirm() : child?.client ? createLiveSchoolReportConfirm(child.client) : null), [confirmSchoolReport, adapter.mode, child?.client])
  const confirmCalendar=useRef<(()=>void)|null>(null), suppressVoiceReply=useRef(false)
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
  const context = { ...calendarScope, canPrepareOrbit:orbit?.canPrepare()??false, readOnly: (session?.marks?.demoGuide===true&&!session.marks.showcaseEditor), childId: session?.scope.childId ?? null, parent: session?.persona.parent ?? false, visiblePeople: people, canReadCare: !!session && (session.persona.parent || session.persona.grants.includes('careplan.read')) }
  useEffect(() => {
    active.current = true
    const unregister = registerPrivateCleanup(() => {
      active.current = false; ++requestId.current; abort.current?.abort(); sent.current = false
      proposals.current.clear(); streamTurn.current=null; setMessages([]); setDraft(''); confirmation.current=null;setPending(null); setOpen(false); setPeople(new Set()); executed.current.clear()
    })
    return () => { active.current = false; proposals.current.clear(); streamTurn.current=null; ++requestId.current; abort.current?.abort(); unregister() }
  }, [registerPrivateCleanup])
  useEffect(() => {
    let current = true
    if (session && dataAdapter) dataAdapter.readVillage(session.scope).then(data => { if (current) setPeople(new Set(data.nodes.map(node => node.person.id))) }, () => { if (current) setPeople(new Set()) })
    return () => { current = false }
  }, [session, dataAdapter])
  // Warm Rosina on page load, re-warm when the panel opens (only if stale), keep-alive every
  // ~60s while the tab is visible (latency playbook 6): the caller's context + lens caches and
  // the model host's prompt-prefix cache stay primed so the FIRST question streams fast.
  useRosinaWarmKeepAlive(session?.accessToken, adapter.mode === 'live')
  useEffect(() => {
    if (open && adapter.mode === 'live' && session?.accessToken) fireRosinaWarmIfStale(session.accessToken)
  }, [open, adapter.mode, session?.accessToken])
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
  function append(from: 'PARENT' | 'ROSINA', text: string, actions: CatalogAction[] = [], schoolReportProposal?: SchoolReportProposal | null, addVillagerProposal?: AddVillagerProposal | null, proposalKeys?:string[]) {
    if (!active.current) return
    const message: ThreadMessage = { id: `local-rosina-${++nextId.current}`, from, kind: 'TEXT', text, at: new Date().toISOString(), relatedJobId: null, relatedInformationRequestId: null, hasVoiceNote: false, actions, proposalKeys:proposalKeys??proposals.current.reconcile(proposals.current.begin(),actions), calendarKey:actions.some(a=>a.id==='calendar-change')?crypto.randomUUID():undefined, schoolReportProposal, addVillagerProposal }
    setMessages(items => [...items, message])
  }
  // /voice/turn already ran the turn. Insert its output; never call ask/send here.
  function appendUserMessage(text:string) { append('PARENT',text); if(/^(yes|yes please|confirm|confirm it)[.!]?$/i.test(text.trim())&&confirmCalendar.current){suppressVoiceReply.current=true;confirmCalendar.current()}else{setMessages(items=>items.map(m=>m.calendarKey&&!m.calendarSaved?{...m,calendarDismissed:true}:m));confirmCalendar.current=null} }
  function appendRosinaReply(reply:string,actions:unknown[]) { if(suppressVoiceReply.current){suppressVoiceReply.current=false;return false as const} accept({reply,actions}) }
  function accept(response: RosinaResponse, turn=proposals.current.begin()) {
    const actions=validateActions(response.actions)
    const keys=proposals.current.reconcile(turn,actions)
    if(confirmation.current!==null&&!keys.includes(confirmation.current)){confirmation.current=null;setPending(null)}
    // Keep validated cards until their live dependencies settle; execution still rechecks permission.
    const orbitOffer=actions.some(action=>action.id==='prepareOrbitAlert')
    append('ROSINA', orbitOffer&&orbit ? 'I can prepare an Orbit message for you to review. Nothing has been activated.' : response.reply, actions, parseSchoolReportProposal(response.schoolReportProposal), parseAddVillagerProposal(response.addVillagerProposal),keys)
  }
  useEffect(()=>{const close=()=>closePanel();window.addEventListener('rosina:close',close);return()=>window.removeEventListener('rosina:close',close)},[])
  function closePanel() {
    if(streamTurn.current!==null)proposals.current.withdraw(streamTurn.current)
    streamTurn.current=null
    ++requestId.current; abort.current?.abort(); abort.current=null; sent.current=false
    setBusy(false);setError('');confirmation.current=null;setPending(null);setOpen(false);setDismissed(true);setLiveStream(null)
    if (location.hash.startsWith('#/ask-rosina')) location.hash = '#/today'
  }
  async function ask(message:string, recordUser=true) {
    if (!message || sent.current || needsSignIn) return
    if(/^(yes|yes please|confirm|confirm it)[.!]?$/i.test(message.trim())&&confirmCalendar.current){if(recordUser)append('PARENT',message);confirmCalendar.current();return}
    setMessages(items=>items.map(m=>m.calendarKey&&!m.calendarSaved?{...m,calendarDismissed:true}:m))
    confirmCalendar.current=null
    const generation=getSessionGeneration(),id=++requestId.current,controller=new AbortController()
    const turn=proposals.current.begin();streamTurn.current=turn
    abort.current=controller
    const owns=()=>active.current && getSessionGeneration()===generation && requestId.current===id && !controller.signal.aborted
    sent.current=true;setProgress('sending');setBusy(true);setError('');setLiveStream(null)
    const history=messages.slice(-40).map(item=>({role:item.from==='PARENT'?'user' as const:'assistant' as const,content:item.text??''}))
    if(recordUser)append('PARENT',message)
    try {
      const response=await adapter.send({turnId:turn,message,currentRoute:location.hash||'#/mission-control',history},controller.signal)
      if(owns()){if(response.notice==='sign-in'){proposals.current.withdraw(turn);confirmation.current=null;setPending(null);setNeedsSignIn(true);const renewed=await renewSession();if(owns()&&renewed){setNeedsSignIn(false);append('ROSINA','Your perspective is ready again. Please send your question again.')}else if(owns()){if(authMode==='live'){setNeedsSignIn(false);append('ROSINA','Busy, try again in a moment')}else accept(response,turn)}}else accept(response,turn)}
    }catch(error){
      if(owns() && !(error instanceof RosinaCancelled)) {
        proposals.current.withdraw(turn);confirmation.current=null;setPending(null)
        if(adapter.mode==='live')append('ROSINA',LIVE_FALLBACK)
        else setError('Rosina could not reply. Try again. Your message was not submitted as an action.')
      }
    }finally{if(owns()){setBusy(false);sent.current=false;abort.current=null;setLiveStream(null);streamTurn.current=null}}
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
    if (!active.current || !proposals.current.allows(key,action) || !validateActions([action]).length || !actionAllowed(action, context) || executed.current.has(key)) return
    // Orbit has its own dedicated screen now; Rosina only deep-links there, never renders Orbit UI in the panel.
    if(action.id==='prepareOrbitAlert'){if(!orbit?.canPrepare())return;executed.current.add(key);closePanel();location.hash='#/orbit';return}
    if (confirmed && confirmation.current!==key) return
    if (catalog[action.id].changesData && !confirmed) { confirmation.current=key;setPending({ action, key }); return }
    if (catalog[action.id].changesData) {
      executed.current.add(key); confirmation.current=null;setPending(null)
      if (adapter.mode === 'mock' || !dataAdapter?.requestPickup || action.id !== 'start-pickup' || !session) {
        append('ROSINA', adapter.mode === 'mock' ? 'Your demo request has been reviewed. No pickup was arranged and nobody was contacted.' : 'Recording requests from here is not wired for this perspective. Nothing was changed.')
        return
      }
      // LIVE: the parent just confirmed, so record the request through the graph's own
      // parent-gated requestPickup. Recording a request contacts nobody; approval is separate.
      try {
        const job = await dataAdapter.requestPickup(session.scope, { childId: action.args.childId, date: action.args.date, window: action.args.window })
        append('ROSINA', `Pickup request recorded: ${pickupStatusLabel(job.status)}. You can watch it in Mission Control. Nobody has been contacted, and your approval stays a separate step.`, [{ id: 'open-screen', args: { screen: 'mission-control' } }])
      } catch {
        append('ROSINA', 'That request did not go through, so nothing was recorded or changed. Try once more in a moment.')
      }
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
  const latestCalendar=[...messages].reverse().find(m=>!m.calendarDismissed&&m.actions.some(a=>a.id==='calendar-change'))
  const latestReport = [...messages].reverse().find(message => message.schoolReportProposal)?.schoolReportProposal
  const reportAccessLoading = adapter.mode === 'live' && child?.authorized.status === 'loading'
  const mayReport = (proposal:SchoolReportProposal) => !!session && (!session.marks?.demoGuide||session.marks.showcaseEditor===true) && proposal.childId === focusedChildId &&
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
        {messages.map(message => <article key={message.id} className={`rosina-message ${message.from === 'PARENT' ? 'from-person' : ''}`}><span>{message.from === 'PARENT' ? 'You' : 'Rosina'}</span><p>{message.text}</p>{reportCard(message)}<AddVillagerReview proposal={parseAddVillagerProposal(message.addVillagerProposal)} liveEnabled={import.meta.env.VITE_ADD_VILLAGER_LIVE === 'true'} />{message.actions.filter(a=>a.id==='calendar-change').map((a,i)=>a.id==='calendar-change'?<CalendarChangeCard key={i} args={a.args} requestKey={message.calendarKey} saved={message.calendarSaved} client={child?.client??null} current={message===latestCalendar} register={fn=>{if(message===latestCalendar)confirmCalendar.current=fn}} onSaved={text=>{setMessages(items=>items.map(m=>m.id===message.id?{...m,calendarSaved:true}:m));append('ROSINA',text)}}/>:null)}{message.actions.map((action,index)=>({action,key:message.proposalKeys[index]})).filter(({action,key}) => action.id!=='calendar-change' && proposals.current.allows(key,action) && catalog[action.id].implemented && (actionAllowed(action, context) || (action.id==='prepareOrbitAlert' && !!orbit && !context.readOnly && context.parent && action.args.childId===context.childId && ['loading','unavailable'].includes(orbit.getSnapshot().phase)))).map(({action,key}) => <button type="button" className="rosina-action" aria-label={actionLabel(action)} key={key} disabled={executed.current.has(key)||!actionAllowed(action,context)} onClick={() => { void execute(action, key) }}>{actionLabel(action)}{action.id==='prepareOrbitAlert'&&!actionAllowed(action,context)&&<span role="status" className="rosina-action-status">{orbit?.getSnapshot().phase==='loading'?'Loading shared Orbit records…':"Couldn't load the shared Orbit records. Refresh Orbit to try again."}</span>}</button>)}</article>)}
        {busy && !!liveStream?.text && <article className="rosina-message is-streaming" aria-label="Rosina is replying"><span>Rosina</span><p>{liveStream.text}<span className="rosina-caret" aria-hidden="true"/></p></article>}
        {busy && !liveStream?.text && <div className="rosina-progress" role="status"><strong><span className="rosina-typing" aria-hidden="true"><i/><i/><i/></span>{adapter.mode==='live'?(liveStream?.status??(progress==='sending'?'Sending your question…':progress==='waiting'?'Waiting for Rosina’s reply…':'Reading Rosina’s reply…')):'Rosina is preparing a reply…'}</strong><span>{elapsed}s elapsed · You can close this panel to stop waiting.</span></div>}
        {busy && !!liveStream?.text && !!liveStream.status && <p className="rosina-progress-inline" role="status">{liveStream.status}</p>}
        {busy && !!liveStream?.actions.length && <article className="rosina-message is-streaming" aria-label="Ready for your review"><span>Rosina</span><p>Ready for your review. Nothing happens until you confirm.</p>{liveStream.actions.map(action=>({action,key:proposals.current.key(streamTurn.current!,action)})).filter(({action}) => action.id!=='calendar-change' && catalog[action.id].implemented && actionAllowed(action, context)).map(({action,key}) => <button type="button" className="rosina-action" aria-label={actionLabel(action)} key={key} disabled={executed.current.has(key)} onClick={() => { void execute(action, key) }}>{actionLabel(action)}</button>)}</article>}
      </div>
      {error && <p className="rosina-error" role="alert">{error}</p>}
      <form onSubmit={send} className="rosina-compose"><label htmlFor="rosina-message" className="sr-only">Message Rosina</label>{!dismissed&&<div className="rosina-compose-tools"><RosinaVoiceButton onTranscript={appendUserMessage} onReply={appendRosinaReply} getHistory={()=>messages.slice(-40).map(item=>({role:item.from==='PARENT'?'user' as const:'assistant' as const,content:item.text??''}))}/><div className="rosina-notice-attach"><NoticeComposer/></div></div>}<div className="rosina-field"><textarea id="rosina-message" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onEnterSubmit(submitDraft)} aria-describedby="rosina-composer-hint" maxLength={4000} rows={1} placeholder="Message Rosina…" /><button type="submit" className="rosina-send" aria-label="Send" disabled={busy || needsSignIn || !draft.trim()}><ArrowUp size={18} aria-hidden /></button></div><span id="rosina-composer-hint" className="sr-only">{COMPOSER_HINT_MULTILINE}</span></form>
    </section>
  return <>
    {!pageTarget && <FgButton ref={launcherRef} className={`rosina-launcher ${dismissed ? 'is-reopen' : ''}`} onClick={() => {setOpen(true);setDismissed(false)}} aria-expanded={open}><MessageCircle size={18} aria-hidden="true" />Ask Rosina</FgButton>}
    {pageTarget ? createPortal(panel, pageTarget) : panel}
    <Dialog.Root open={!!pending} onOpenChange={value => { if (!value) {confirmation.current=null;setPending(null)} }}><Dialog.Portal><Dialog.Overlay className="rosina-confirm-overlay" /><Dialog.Content className="rosina-confirm"><Dialog.Title>Confirm pickup request</Dialog.Title><Dialog.Description>Review the child, date and window. {adapter.mode === 'mock' ? 'This is a demo request. It doesn’t arrange a pickup.' : 'Confirming records the request. It contacts nobody and arranges nothing until you approve.'}</Dialog.Description>{pending?.action.id === 'start-pickup' && <dl><dt>Child</dt><dd>{session?.scope.childName}</dd><dt>Date</dt><dd>{pending.action.args.date}</dd><dt>Window</dt><dd>{pending.action.args.window}</dd></dl>}<button type="button" onClick={() => { if (pending) void execute(pending.action, pending.key, true) }}>Confirm {adapter.mode === 'mock' ? 'demo ' : ''}pickup request</button><Dialog.Close>Cancel</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>
}
