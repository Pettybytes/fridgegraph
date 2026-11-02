import { useEffect, useMemo, useRef, useState } from 'react'
import { FgButton, InlineFeedback, Surface } from '@/components/fg/primitives'
import { useChildAccess } from '@/features/personas/childContext'
import { useSession } from '@/features/personas/Session'
import { createMockInvite } from './fixture'
import { inviteCredit, inviteError, type InviteCreator, type InviteEvent, type InviteResponse } from './invite'
import { canvasPng, decodeInviteArt, drawInvitation, invitationText, waitForInviteFont } from './renderInvite'
import './invites.css'

type Phase = 'idle' | 'generating' | 'clarification' | 'ready' | 'refused' | 'failed'

/** One-line mock mount: <InvitesPanel />. A later adapter may pass the authenticated
 * creator and mode="live" after the invite endpoint is served and verified. */
export function InvitesPanel({ mode = 'mock', createInvite }: { mode?: 'mock' | 'live'; createInvite?: InviteCreator }) {
  const { session } = useSession()
  const child = useChildAccess()
  const childId = child?.selectedChildId ?? ''
  const childName = child?.selectedChildName ?? ''
  const firstName = childName.trim().split(/\s+/)[0] || 'Child'
  const permitted = !!session && !!child && (session.persona.parent || session.persona.guardian) &&
    !session.marks?.demoGuide && session.scope.childId === childId
  const creator = useMemo(() => createInvite ?? (mode === 'mock' ? createMockInvite(firstName) : null), [createInvite, mode, firstName])
  const identityKey = `${session?.generation ?? 'signed-out'}:${session?.persona.personId ?? ''}:${childId}`
  if (!permitted) return <Surface className="invites-panel" role="region" aria-label="Invitations unavailable">
    <h2>Invitations</h2><InlineFeedback tone="warning">Only a parent or guardian viewing their child can prepare an invitation.</InlineFeedback>
  </Surface>
  return <InviteComposer key={identityKey} childId={childId} childFirstName={firstName} mode={mode} createInvite={creator} />
}

export function InviteComposer({ childId, childFirstName, mode, createInvite }: {
  childId: string; childFirstName: string; mode: 'mock' | 'live'; createInvite: InviteCreator | null
}) {
  const [request, setRequest] = useState(`Create a birthday invitation for ${childFirstName} on November 7, 2026, from 2–4 PM at Riverside Park.`)
  const [phase, setPhase] = useState<Phase>('idle')
  const [detail, setDetail] = useState('')
  const [result, setResult] = useState<InviteResponse | null>(null)
  const pending = useRef<AbortController | null>(null)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false; pending.current?.abort() } }, [])

  async function prepare() {
    if (!createInvite || !request.trim() || phase === 'generating') return
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setResult(null)
    setDetail('')
    setPhase('generating')
    try {
      const next = await createInvite({ childId, request: request.trim() }, controller.signal)
      if (!active.current || controller.signal.aborted) return
      if (next.status === 'NEEDS_CLARIFICATION') {
        setResult(null)
        setDetail(next.clarification?.trim() || 'The invitation service did not return its clarification question. Try again later.')
        setPhase(next.clarification?.trim() ? 'clarification' : 'failed')
      } else if (next.status === 'READY' && next.art) {
        setResult(next)
        setPhase('ready')
      } else {
        setDetail('The invitation service returned no art. No card is ready to download.')
        setPhase('failed')
      }
    } catch (error) {
      if (!active.current || controller.signal.aborted) return
      const failure = inviteError(error)
      setDetail(failure.message)
      setPhase(failure.state)
    } finally {
      if (pending.current === controller) pending.current = null
    }
  }

  return <Surface className="invites-panel" role="region" aria-label="Prepare invitation" data-phase={phase} data-mode={mode}>
    <div className="invites-panel__heading"><div><p className="invites-panel__eyebrow">{mode === 'mock' ? 'Sample preview' : 'Invitation'}</p><h2>Invitation card</h2></div></div>
    <label className="invites-panel__request">Your invitation request
      <textarea value={request} onChange={event => setRequest(event.target.value)} rows={3} disabled={phase === 'generating'} />
    </label>
    {mode === 'mock' && <InlineFeedback>This is a fixed fictional sample. Your words are not interpreted, and no image model or invitation record is called.</InlineFeedback>}
    {mode === 'live' && !createInvite && <InlineFeedback tone="warning">The invitation service is not available in this view.</InlineFeedback>}
    <FgButton type="button" disabled={!createInvite || !request.trim() || phase === 'generating'} loading={phase === 'generating'} onClick={() => { void prepare() }}>
      {phase === 'generating' ? (mode === 'mock' ? 'Loading sample art…' : 'Generating art…') : mode === 'mock' ? 'Show sample invitation' : 'Prepare invitation'}
    </FgButton>
    {phase === 'generating' && <p role="status">{mode === 'mock' ? 'Loading the sample art. No model call is being made.' : 'Preparing invitation art. Wait for a result before editing or downloading.'}</p>}
    {phase === 'clarification' && <InlineFeedback tone="warning"><strong>One detail is needed:</strong> {detail} Add it to your request and prepare again. No art was returned.</InlineFeedback>}
    {phase === 'refused' && <InlineFeedback tone="error">{detail}</InlineFeedback>}
    {phase === 'failed' && <InlineFeedback tone="error">{detail}</InlineFeedback>}
    {phase === 'ready' && result?.art && <InvitationCard key={`${result.provenance.promptHash}:${result.art.base64.length}`} result={{ ...result, art: result.art }} />}
  </Surface>
}

export function InvitationCard({ result }: { result: InviteResponse & { art: NonNullable<InviteResponse['art']> } }) {
  const [event, setEvent] = useState<InviteEvent>(result.event)
  const [previewReady, setPreviewReady] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const image = useRef<HTMLImageElement | null>(null)
  const eventRef = useRef(event)
  eventRef.current = event

  useEffect(() => {
    let active = true
    let dispose = () => {}
    setPreviewReady(false)
    setPreviewError('')
    void (async () => {
      try {
        const loaded = await decodeInviteArt(result.art)
        dispose = loaded.dispose
        await waitForInviteFont()
        if (!active) return
        image.current = loaded.image
        if (canvas.current) drawInvitation(canvas.current, loaded.image, result.art, eventRef.current, result.provenance)
        setPreviewReady(true)
      } catch (error) { if (active) setPreviewError(error instanceof Error ? error.message : 'The art could not be displayed.') }
    })()
    return () => { active = false; image.current = null; dispose() }
    // A new result remounts this component; editing is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.art])

  useEffect(() => {
    if (!image.current || !canvas.current) return
    try { drawInvitation(canvas.current, image.current, result.art, event, result.provenance); setPreviewError(''); setPreviewReady(true) }
    catch (error) { setPreviewError(error instanceof Error ? error.message : 'The event text does not fit.'); setPreviewReady(false) }
  }, [event, result.art, result.provenance])

  async function download() {
    if (!canvas.current || !image.current || !previewReady || downloading) return
    setDownloading(true)
    setPreviewError('')
    try {
      await waitForInviteFont()
      await image.current.decode()
      drawInvitation(canvas.current, image.current, result.art, event, result.provenance)
      const png = await canvasPng(canvas.current)
      const url = URL.createObjectURL(png)
      const link = document.createElement('a')
      link.href = url
      link.download = `invitation-${event.childFirstName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'card'}.png`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setPreviewError(error instanceof Error ? error.message : 'PNG download failed.') }
    finally { setDownloading(false) }
  }

  const update = <K extends keyof InviteEvent>(key: K, value: InviteEvent[K]) => setEvent(current => ({ ...current, [key]: value }))
  const text = invitationText(event)
  return <div className="invites-card" role="region" aria-label="Invitation card ready">
    <div className="invites-card__preview">
      <canvas ref={canvas} width={result.art.width} height={result.art.height} role="img" aria-label={`${text[0]}, ${text[1]}. ${text[2]}. ${text[3]}. ${text[4]}.`} />
      {!previewReady && !previewError && <p role="status">Preparing the card preview…</p>}
      <p className="invites-card__credit">{inviteCredit(result.provenance)}</p>
    </div>
    <div className="invites-card__editor"><h3>Check the event text</h3><p>Edit these words without making new art.</p>
      <div className="invites-card__fields">
        <label>Child’s first name<input value={event.childFirstName} onChange={e => update('childFirstName', e.target.value)} /></label>
        <label>Occasion<input value={event.occasion} onChange={e => update('occasion', e.target.value)} /></label>
        <label>Date<input type="date" value={event.date ?? ''} onChange={e => update('date', e.target.value || null)} /></label>
        <label>Start time<input type="time" value={event.startTime ?? ''} onChange={e => update('startTime', e.target.value || null)} /></label>
        <label>End time<input type="time" value={event.endTime ?? ''} onChange={e => update('endTime', e.target.value || null)} /></label>
        <label>Place<input value={event.placeLabel ?? ''} onChange={e => update('placeLabel', e.target.value || null)} /></label>
      </div>
      <p className="invites-card__timezone">Times are shown in America/Detroit.</p>
      {previewError && <InlineFeedback tone="error">{previewError}</InlineFeedback>}
      <FgButton type="button" disabled={!previewReady || downloading} loading={downloading} onClick={() => { void download() }}>Download PNG</FgButton>
    </div>
  </div>
}
