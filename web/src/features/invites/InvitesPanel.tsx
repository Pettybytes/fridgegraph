import { useEffect, useMemo, useRef, useState } from 'react'
import { FgButton, InlineFeedback, Surface } from '@/components/fg/primitives'
import { useChildAccess } from '@/features/personas/childContext'
import { useSession } from '@/features/personas/Session'
import { createMockInvite } from './fixture'
import {
  inviteCredit, inviteError, withInviteDefaults, readReferenceFile, REFERENCE_ACCEPT, REQUEST_MAX_CHARS,
  type InviteCreator, type InviteEvent, type InviteResponse, type InviteReferenceImage,
} from './invite'
import { canvasPng, decodeInviteArt, drawInvitation, invitationText, lineSpecs, toRevisionReference, waitForInviteFont } from './renderInvite'
import './invites.css'

type Phase = 'idle' | 'generating' | 'ready' | 'refused' | 'failed'

/** The exact inputs of one generate attempt, captured so Retry can repeat THAT operation — same
 *  mode, same reference, same revision intent — instead of silently starting a fresh prepare. */
type Attempt = { request: string; referenceImage?: InviteReferenceImage; revise: boolean }

/** On a successful REVISION, keep the parent's already-edited event fields; only fill a still-empty
 *  field from the fresh extraction. A revision instruction ("add balloons") does not describe the
 *  schedule, so it must never replace an existing name/date/place/host/message with an empty default. */
function mergePreservingEdits(prior: InviteEvent, next: InviteEvent): InviteEvent {
  const keep = (a: string, b: string) => (a.trim() ? a : b)
  return {
    childFirstName: keep(prior.childFirstName, next.childFirstName),
    occasion: keep(prior.occasion, next.occasion),
    date: prior.date ?? next.date,
    startTime: prior.startTime ?? next.startTime,
    endTime: prior.endTime ?? next.endTime,
    timezone: 'America/Detroit',
    placeLabel: prior.placeLabel ?? next.placeLabel,
    hostName: keep(prior.hostName, next.hostName),
    message: keep(prior.message, next.message),
  }
}

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
  return <InviteComposer
    key={identityKey}
    childId={childId}
    childFirstName={firstName}
    mode={mode}
    createInvite={creator}
    defaultHostName={session?.scope.parentName ?? ''}
  />
}

export function InviteComposer({ childId, childFirstName, mode, createInvite, defaultHostName = '' }: {
  childId: string; childFirstName: string; mode: 'mock' | 'live'; createInvite: InviteCreator | null; defaultHostName?: string
}) {
  const [request, setRequest] = useState(`Create a birthday invitation for ${childFirstName} on November 15, 2026, from 2–4 PM at Maple Hall.`)
  const [phase, setPhase] = useState<Phase>('idle')
  const [detail, setDetail] = useState('')
  const [result, setResult] = useState<InviteResponse | null>(null)
  // The editable event is lifted HERE (not owned by the card) so a successful revision can keep the
  // parent's already-edited fields instead of replacing them with a fresh, often-empty extraction.
  const [event, setEvent] = useState<InviteEvent | null>(null)
  const eventRef = useRef<InviteEvent | null>(null)
  eventRef.current = event
  // Optional reference image to REMIX: the actual image is transformed to match the request
  // (image-to-image). Held in memory; sent with the request and discarded server-side after use.
  const [reference, setReference] = useState<{ image: InviteReferenceImage; previewUrl: string; name: string } | null>(null)
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [referenceError, setReferenceError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const pending = useRef<AbortController | null>(null)
  const lastAttempt = useRef<Attempt | null>(null)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false; pending.current?.abort() } }, [])

  async function acceptFile(file: File | undefined | null) {
    setReferenceError('')
    if (!file) return
    setReferenceBusy(true)
    const read = await readReferenceFile(file)
    if (!active.current) return
    setReferenceBusy(false)
    if (!read.ok) { setReferenceError(read.error); return }
    setReference({ image: read.image, previewUrl: read.previewUrl, name: file.name })
  }

  // The one request path. The last successful design (`result`/`event`) is deliberately NOT cleared
  // while a request is in flight or on failure, so a parent never loses a good card to a retry.
  async function execute(attempt: Attempt) {
    if (!createInvite || !attempt.request || phase === 'generating') return
    lastAttempt.current = attempt // captured so Retry repeats THIS exact operation
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setDetail('')
    setPhase('generating')
    try {
      const next = await createInvite({ childId, request: attempt.request, referenceImage: attempt.referenceImage, revise: attempt.revise }, controller.signal)
      if (!active.current || controller.signal.aborted) return
      if (next.art) {
        // hostName/message are app-owned: fill blanks here, never overwriting a family's own value.
        const extracted = withInviteDefaults(next.event, defaultHostName)
        // A revision keeps the parent's current (edited) fields; a fresh design adopts the new ones.
        const nextEvent = attempt.revise && eventRef.current ? mergePreservingEdits(eventRef.current, extracted) : extracted
        setResult(next)
        setEvent(nextEvent)
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

  // A fresh generation driven by the request + any uploaded reference.
  function prepareNew() { void execute({ request: request.trim(), referenceImage: reference?.image, revise: false }) }

  // A revision re-runs against the CURRENT generated art (sent back as the reference) so the result
  // keeps every existing element the request doesn't change. The result may exceed the reference
  // limits, so it is resized to fit before it is sent (toRevisionReference) — every result is revisable.
  async function reviseDesign() {
    if (!createInvite || !request.trim() || phase === 'generating' || !result?.art) return
    let referenceImage: InviteReferenceImage
    try { referenceImage = await toRevisionReference(result.art) }
    catch (error) { setDetail(error instanceof Error ? error.message : 'This design could not be prepared for revision.'); setPhase('failed'); return }
    if (!active.current) return
    void execute({ request: request.trim(), referenceImage, revise: true })
  }

  // Retry repeats the LAST attempt exactly — same mode, reference and revision intent.
  function retry() { void execute(lastAttempt.current ?? { request: request.trim(), referenceImage: reference?.image, revise: false }) }

  return <Surface className="invites-panel" role="region" aria-label="Prepare invitation" data-phase={phase} data-mode={mode}>
    <div className="invites-panel__heading"><div><p className="invites-panel__eyebrow">{mode === 'mock' ? 'Sample preview' : 'Invitation'}</p><h2>Invitation card</h2></div></div>
    <label className="invites-panel__request">Your invitation request
      <textarea value={request} onChange={event => setRequest(event.target.value.slice(0, REQUEST_MAX_CHARS))} rows={3} maxLength={REQUEST_MAX_CHARS} disabled={phase === 'generating'} />
    </label>
    <span className="invites-panel__counter" aria-live="polite">{request.length} / {REQUEST_MAX_CHARS}</span>

    {/* Optional reference image — the actual image is remixed to match the request (image-to-image). */}
    <div className="invites-panel__reference" role="group" aria-label="Reference image (optional)">
      <div className="invites-panel__reference-head">
        <span className="invites-panel__reference-title">Add a reference image <span className="invites-panel__optional">optional</span></span>
        <span className="invites-panel__reference-hint">Your image guides the generated art — it is remixed to match your request (for example, “turn these into warrior unicorns”).</span>
      </div>
      {!reference ? (
        <div
          className={`invites-dropzone${dragging ? ' is-dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); void acceptFile(e.dataTransfer.files?.[0]) }}
        >
          <input
            ref={fileInput} type="file" className="invites-dropzone__input" accept={REFERENCE_ACCEPT.join(',')}
            disabled={phase === 'generating' || referenceBusy}
            onChange={e => { void acceptFile(e.target.files?.[0]); e.target.value = '' }}
          />
          <p className="invites-dropzone__label">{referenceBusy ? 'Reading image…' : 'Drag an image here, or'}</p>
          <FgButton type="button" variant="secondary" disabled={phase === 'generating' || referenceBusy} onClick={() => fileInput.current?.click()}>Choose image</FgButton>
          <p className="invites-dropzone__meta">PNG, JPEG, or WebP · up to 5 MB</p>
        </div>
      ) : (
        <div className="invites-reference-preview">
          <img src={reference.previewUrl} alt={`Reference: ${reference.name}`} className="invites-reference-preview__img" />
          <div className="invites-reference-preview__body">
            <p className="invites-reference-preview__name" title={reference.name}>{reference.name}</p>
            <div className="invites-reference-preview__actions">
              <FgButton type="button" variant="secondary" disabled={phase === 'generating' || referenceBusy} onClick={() => fileInput.current?.click()}>Replace</FgButton>
              <FgButton type="button" variant="quiet" disabled={phase === 'generating'} onClick={() => { setReference(null); setReferenceError('') }}>Remove</FgButton>
            </div>
          </div>
          <input ref={fileInput} type="file" className="invites-dropzone__input" accept={REFERENCE_ACCEPT.join(',')} onChange={e => { void acceptFile(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      )}
      {referenceError && <InlineFeedback tone="error">{referenceError}</InlineFeedback>}
      {mode === 'mock' && reference && <InlineFeedback>This sample preview doesn’t transform your reference — turn on live generation to remix your image.</InlineFeedback>}
      {result?.reference?.requested && result.reference.applied === false && phase === 'ready' && mode === 'live' &&
        <InlineFeedback tone="warning">Your reference was received, but it couldn’t be applied to this card. The default art was used.</InlineFeedback>}
    </div>

    {mode === 'mock' && <InlineFeedback>This is a fixed fictional sample. Your words are not interpreted, and no image model or invitation record is called.</InlineFeedback>}
    {mode === 'live' && !createInvite && <InlineFeedback tone="warning">The invitation service is not available in this view.</InlineFeedback>}
    <div className="invites-panel__actions">
      <FgButton type="button" disabled={!createInvite || !request.trim() || phase === 'generating'} loading={phase === 'generating'} onClick={prepareNew}>
        {phase === 'generating' ? (mode === 'mock' ? 'Loading sample art…' : 'Generating art…') : mode === 'mock' ? 'Show sample invitation' : result ? 'Prepare a new invitation' : 'Prepare invitation'}
      </FgButton>
      {result?.art && <FgButton type="button" variant="secondary" disabled={!createInvite || !request.trim() || phase === 'generating'} onClick={() => { void reviseDesign() }}>Revise this design</FgButton>}
    </div>
    {result?.art && phase !== 'generating' && <p className="invites-panel__revise-hint">To revise, edit your request above (for example, “add floating balloons but keep the unicorns”) and choose <strong>Revise this design</strong> — it changes the current art, keeping everything you don’t ask to change, and keeps your edited event text.</p>}
    {phase === 'generating' && <p role="status">{mode === 'mock' ? 'Loading the sample art. No model call is being made.' : result ? 'Preparing a new design. Your current card stays ready below until this finishes.' : 'Preparing invitation art. Wait for a result before editing or downloading.'}</p>}
    {phase === 'ready' && result?.suggestion && <InlineFeedback>{result.suggestion}</InlineFeedback>}
    {(phase === 'refused' || phase === 'failed') && <>
      <InlineFeedback tone="error">{detail}</InlineFeedback>
      {phase === 'failed' && <FgButton type="button" variant="secondary" disabled={!createInvite || !request.trim()} onClick={retry}>Retry</FgButton>}
    </>}
    {/* The last successful design stays visible across every later phase — generating or a failure
        never remove a card the parent already has. */}
    {result?.art && event && <InvitationCard key={`${result.provenance.promptHash}:${result.art.base64.length}`} result={{ ...result, art: result.art }} event={event} onEventChange={setEvent} mode={mode} />}
  </Surface>
}

/** Human-readable source line for the card. The canvas itself always draws the short credit
 *  (`Sample art` / `Art generated with Muse Image`); this adds the reason in plain words so a
 *  judgement call never mistakes fixture art for a new generation. */
function sourceNote(result: InviteResponse & { art: NonNullable<InviteResponse['art']> }, mode: 'mock' | 'live'): string {
  if (result.provenance.source === 'MUSE_IMAGE') {
    return result.provenance.cached
      ? 'Art generated with Muse Image, served from the prompt cache — no new image was generated for this request.'
      : 'Art generated with Muse Image for this request.'
  }
  return mode === 'mock'
    ? 'A fixed fixture illustration, not a new generation. Edit the words below and the art stays the same.'
    : 'Live art generation is switched off here, so this is the labelled fixture illustration — not a newly generated image.'
}

export function InvitationCard({ result, event, onEventChange, mode = 'mock' }: {
  result: InviteResponse & { art: NonNullable<InviteResponse['art']> }
  event: InviteEvent; onEventChange: (next: InviteEvent) => void; mode?: 'mock' | 'live'
}) {
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

  const update = <K extends keyof InviteEvent>(key: K, value: InviteEvent[K]) => onEventChange({ ...event, [key]: value })
  const text = invitationText(event)
  const readout = lineSpecs(event)
  return <div className="invites-card" role="region" aria-label="Invitation card ready">
    <div className="invites-card__preview">
      <p className="invites-card__caption">Downloaded PNG · {result.art.width} × {result.art.height}</p>
      <canvas ref={canvas} width={result.art.width} height={result.art.height} role="img" aria-label={`${text.join('. ')}.`} />
      {!previewReady && !previewError && <p role="status">Preparing the card preview…</p>}
      <p className="invites-card__credit">{inviteCredit(result.provenance)}</p>
      <p className="invites-card__source" data-source={result.provenance.source}>{sourceNote(result, mode)}</p>
      {text.length > 0 && <div className="invites-card__readout" aria-label="Invitation text">
        {readout.map(line => <p key={line.role} className={`invites-card__line invites-card__line--${line.role}`}>{line.text}</p>)}
      </div>}
    </div>
    <div className="invites-card__editor"><h3>Check the event text</h3><p>Edit these words without making new art.</p>
      <div className="invites-card__fields">
        <label className="invites-card__field--full">Hosted by<input value={event.hostName} onChange={e => update('hostName', e.target.value)} placeholder="Add a host name" /></label>
        <label>Child’s first name<input value={event.childFirstName} onChange={e => update('childFirstName', e.target.value)} /></label>
        <label className="invites-card__field--full">Occasion<input value={event.occasion} onChange={e => update('occasion', e.target.value)} /></label>
        <label>Date<input type="date" value={event.date ?? ''} onChange={e => update('date', e.target.value || null)} /></label>
        <label>Start time<input type="time" value={event.startTime ?? ''} onChange={e => update('startTime', e.target.value || null)} /></label>
        <label>End time<input type="time" value={event.endTime ?? ''} onChange={e => update('endTime', e.target.value || null)} /></label>
        <label className="invites-card__field--full">Place<input value={event.placeLabel ?? ''} onChange={e => update('placeLabel', e.target.value || null)} /></label>
        <label className="invites-card__field--full">Personal message<textarea rows={2} value={event.message} onChange={e => update('message', e.target.value)} placeholder="A short note for your guests" /></label>
      </div>
      <p className="invites-card__timezone">Times are shown in America/Detroit.</p>
      {previewError && <InlineFeedback tone="error">{previewError}</InlineFeedback>}
      <FgButton type="button" disabled={!previewReady || downloading} loading={downloading} onClick={() => { void download() }}>Download PNG</FgButton>
    </div>
  </div>
}
