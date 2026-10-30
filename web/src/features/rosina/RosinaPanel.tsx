import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Dialog } from 'radix-ui'
import { MessageCircle, X } from 'lucide-react'
import { useSession } from '@/features/personas/Session'
import type { ChatMessage, FrontendAdapter } from '@/lib/frontendData/types'
import { actionAllowed, actionRoute, catalog, validateActions } from './catalog'
import type { CatalogAction, Screen } from './catalog'
import { createMockRosinaAdapter } from './adapter'
import type { RosinaAdapter, RosinaResponse } from './adapter'
import './rosina.css'
type ThreadMessage = ChatMessage & { actions: CatalogAction[] }
export function RosinaPanel({ dataAdapter, service }: { dataAdapter?: FrontendAdapter; service?: RosinaAdapter }) {
  const { session, registerPrivateCleanup } = useSession()
  const adapter = useMemo(() => service ?? createMockRosinaAdapter(session, dataAdapter), [session, dataAdapter, service])
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [people, setPeople] = useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = useState<{ action: CatalogAction; key: string } | null>(null)
  const nextId = useRef(0), active = useRef(true), abort = useRef<AbortController | null>(null)
  const threadRef = useRef<HTMLDivElement>(null), launcherRef = useRef<HTMLButtonElement>(null)
  const sent = useRef(false), executed = useRef(new Set<string>())
  const context = { childId: session?.scope.childId ?? null, parent: session?.persona.parent ?? false, visiblePeople: people }
  useEffect(() => {
    active.current = true
    const unregister = registerPrivateCleanup(() => {
      active.current = false; abort.current?.abort(); sent.current = false
      setMessages([]); setDraft(''); setPending(null); setOpen(false); setPeople(new Set()); executed.current.clear()
    })
    return () => { active.current = false; abort.current?.abort(); unregister() }
  }, [registerPrivateCleanup])
  useEffect(() => {
    let current = true
    if (session && dataAdapter) dataAdapter.readVillage(session.scope).then(data => { if (current) setPeople(new Set(data.nodes.map(node => node.person.id))) }, () => { if (current) setPeople(new Set()) })
    return () => { current = false }
  }, [session, dataAdapter])
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [messages, busy])
  function append(from: 'PARENT' | 'ROSINA', text: string, actions: CatalogAction[] = []) {
    if (!active.current) return
    const message: ThreadMessage = { id: `local-rosina-${++nextId.current}`, from, kind: 'TEXT', text, at: new Date().toISOString(), relatedJobId: null, relatedInformationRequestId: null, hasVoiceNote: false, actions }
    setMessages(items => [...items, message])
  }
  function accept(response: RosinaResponse) {
    append('ROSINA', response.reply, validateActions(response.actions).filter(action => actionAllowed(action, context)))
  }
  async function send(event: FormEvent) {
    event.preventDefault()
    const message = draft.trim()
    if (!message || sent.current) return
    sent.current = true; setBusy(true); setError(''); setDraft('')
    abort.current = new AbortController()
    const history = messages.map(item => ({ role: item.from === 'PARENT' ? 'user' as const : 'assistant' as const, content: item.text ?? '' }))
    append('PARENT', message)
    try { const response = await adapter.send({ message, currentRoute: location.hash || '#/mission-control', history }, abort.current.signal); if (active.current) accept(response) }
    catch { if (active.current) setError('Rosina could not reply. Try again. Your message was not submitted as an action.') }
    finally { if (active.current) { setBusy(false); sent.current = false } }
  }
  async function execute(action: CatalogAction, key: string, confirmed = false) {
    if (!active.current || !validateActions([action]).length || !actionAllowed(action, context) || executed.current.has(key)) return
    if (catalog[action.id].changesData && !confirmed) { setPending({ action, key }); return }
    if (catalog[action.id].changesData) {
      executed.current.add(key); setPending(null)
      append('ROSINA', adapter.mode === 'mock' ? 'Mock pickup request reviewed. No live job was created and nobody was contacted.' : 'Pickup submission is unavailable until live action integration is delivered.')
      return
    }
    const route = actionRoute(action)
    if (route) { location.hash = route; setOpen(false); return }
    if (action.id === 'explain-screen') {
      append('ROSINA', action.args.screen === 'village' ? 'Living Village shows the people and recorded relationships available within your access. It does not grant new access.' : 'Mission Control shows recorded pickup facts. Acceptance, parent approval and pickup completion are separate; a missing fact stays unknown.')
    }
    if (action.id === 'explain-recommendation') {
      try { accept(await adapter.send({ message: 'Why was this caregiver recommended?', currentRoute: location.hash, history: messages.map(item => ({ role: item.from === 'PARENT' ? 'user' as const : 'assistant' as const, content: item.text ?? '' })) })) }
      catch { if (active.current) setError('The recommendation is unavailable.') }
    }
  }
  const screen: Screen = location.hash.startsWith('#/village') ? 'village' : 'mission-control'
  return <>
    <button type="button" ref={launcherRef} className="rosina-launcher" onClick={() => setOpen(true)} aria-expanded={open}><MessageCircle size={18} aria-hidden="true" />Ask Rosina</button>
    <section onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); launcherRef.current?.focus() } }} className={`rosina-panel ${open ? 'is-open' : ''}`} aria-label="Ask Rosina" data-state={adapter.mode === 'mock' ? 'unavailable' : 'live'}>
      <header><div><h2>Ask Rosina</h2><p>FridgeGraph's AI family coordinator</p></div><button type="button" aria-label="Close Ask Rosina" onClick={() => setOpen(false)}><X size={18} /></button></header>
      <p className="rosina-source">{adapter.mode === 'mock' ? 'Scripted demo · client-side conversation' : 'Connected · client-side conversation'}</p>
      <div ref={threadRef} className="rosina-thread" role="log" aria-label="Rosina conversation" aria-live="polite">
        {!messages.length && <div className="rosina-welcome"><MessageCircle size={28} aria-hidden="true" /><h3>A little help with your village.</h3><p>Ask about what you can see or prepare a request. You confirm every change.</p><button type="button" onClick={() => append('ROSINA', screen === 'village' ? 'This screen shows your available people and recorded relationships.' : 'This screen shows recorded pickup facts, with approval kept separate from acceptance.')}>Explain this screen</button></div>}
        {messages.map(message => <article key={message.id} className={`rosina-message ${message.from === 'PARENT' ? 'from-person' : ''}`}><span>{message.from === 'PARENT' ? 'You' : 'Rosina'}</span><p>{message.text}</p>{message.actions.filter(action => catalog[action.id].implemented && actionAllowed(action, context)).map((action, index) => <button type="button" className="rosina-action" key={index} disabled={executed.current.has(`${message.id}:${index}`)} onClick={() => { void execute(action, `${message.id}:${index}`) }}>{catalog[action.id].label}{action.id === 'open-screen' && ` · ${action.args.screen === 'village' ? 'Living Village' : 'Mission Control'}`}{action.id === 'start-pickup' && ` · ${action.args.date} ${action.args.window}`}</button>)}</article>)}
        {busy && <p role="status">Rosina is preparing a reply…</p>}
      </div>
      {error && <p className="rosina-error" role="alert">{error}</p>}
      <form onSubmit={send}><label htmlFor="rosina-message">Message Rosina</label><div><textarea id="rosina-message" value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} rows={2} placeholder="What can I do here?" /><button type="submit" disabled={busy || !draft.trim()}>Send</button></div></form>
    </section>
    <Dialog.Root open={!!pending} onOpenChange={value => { if (!value) setPending(null) }}><Dialog.Portal><Dialog.Overlay className="rosina-confirm-overlay" /><Dialog.Content className="rosina-confirm"><Dialog.Title>Confirm pickup request</Dialog.Title><Dialog.Description>Review the child, date and window. {adapter.mode === 'mock' ? 'This is a mock action; it creates no live job.' : 'Live submission is unavailable.'}</Dialog.Description>{pending?.action.id === 'start-pickup' && <dl><dt>Child</dt><dd>{session?.scope.childName}</dd><dt>Date</dt><dd>{pending.action.args.date}</dd><dt>Window</dt><dd>{pending.action.args.window}</dd></dl>}<button type="button" onClick={() => { if (pending) void execute(pending.action, pending.key, true) }}>Confirm {adapter.mode === 'mock' ? 'mock ' : ''}pickup request</button><Dialog.Close>Cancel</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>
}
