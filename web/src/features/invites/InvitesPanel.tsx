import { useEffect, useMemo, useRef, useState } from 'react'
import { FgButton, InlineFeedback, Surface } from '@/components/fg/primitives'
import { useChildAccess } from '@/features/personas/childContext'
import { useSession } from '@/features/personas/Session'
import { createMockInvite } from './fixture'
import {
  inviteCredit, inviteError, withInviteDefaults, readReferenceFile, REFERENCE_ACCEPT,
  type InviteCreator, type InviteEvent, type InviteResponse, type InviteReferenceImage,
} from './invite'
import { canvasPng, decodeInviteArt, drawInvitation, invitationText, lineSpecs, waitForInviteFont } from './renderInvite'
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
  // Optional reference image (style inspiration only — never placed in the card). Held in memory;
  // sent with the request and discarded server-side after generation.
  const [reference, setReference] = useState<{ image: InviteReferenceImage; previewUrl: string; name: string } | null>(null)
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [referenceError, setReferenceError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const pending = useRef<AbortController | null>(null)
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

  async function prepare() {
    if (!createInvite || !request.trim() || phase === 'generating') return
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    // The last successful design (`result`) is deliberately NOT cleared here — it stays on screen
    // while this request is in flight, and stays put if it fails, so a parent never loses a good
    // card to a regeneration attempt. It is only ever replaced by a NEW successful result below.
    setDetail('')
    setPhase('generating')
    try {
      const next = await createInvite({ childId, request: request.trim(), referenceImage: reference?.image }, controller.signal)
      if (!active.current || controller.signal.aborted) return
      if (next.status === 'NEEDS_CLARIFICATION') {
        const question = next.clarification?.question.trim()
        setDetail(question || 'The invitation service did not return its clarification question. Try again later.')
        setPhase(question ? 'clarification' : 'failed')
      } else if (next.status === 'READY' && next.art) {
        // hostName/message are app-owned, not part of any backend extraction: fill them here so
        // the card always reads like a real invitation, and never overwrite a family's own value.
        setResult({ ...next, event: withInviteDefaults(next.event, defaultHostName) })
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

    {/* Optional reference image — style inspiration only; never placed in the card. */}
    <div className="invites-panel__reference" role="group" aria-label="Reference image (optional)">
      <div className="invites-panel__reference-head">
        <span className="invites-panel__reference-title">Add a reference image <span className="invites-panel__optional">optional</span></span>
        <span className="invites-panel__reference-hint">Guides the art style (palette, look, mood) — your image is never shown in the card.</span>
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
      {mode === 'mock' && reference && <InlineFeedback>Reference images guide the art style only when live generation is on. This sample ignores it.</InlineFeedback>}
      {result?.reference?.requested && result.reference.applied === false && phase === 'ready' &&
        <InlineFeedback tone="warning">Your reference was received, but its style wasn’t applied to this card{mode === 'live' ? ' — live style generation is off or the style could not be read' : ''}. The default art style was used.</InlineFeedback>}
    </div>

    {mode === 'mock' && <InlineFeedback>This is a fixed fictional sample. Your words are not interpreted, and no image model or invitation record is called.</InlineFeedback>}
    {mode === 'live' && !createInvite && <InlineFeedback tone="warning">The invitation service is not available in this view.</InlineFeedback>}
    <FgButton type="button" disabled={!createInvite || !request.trim() || phase === 'generating'} loading={phase === 'generating'} onClick={() => { void prepare() }}>
      {phase === 'generating' ? (mode === 'mock' ? 'Loading sample art…' : 'Generating art…') : mode === 'mock' ? 'Show sample invitation' : result ? 'Prepare a new invitation' : 'Prepare invitation'}
    </FgButton>
    {phase === 'generating' && <p role="status">{mode === 'mock' ? 'Loading the sample art. No model call is being made.' : result ? 'Preparing a new design. Your current card stays ready below until this finishes.' : 'Preparing invitation art. Wait for a result before editing or downloading.'}</p>}
    {phase === 'clarification' && <InlineFeedback tone="warning"><strong>One detail is needed:</strong> {detail} Add it to your request and prepare again. No new art was returned{result ? ' — your current card is unchanged.' : '.'}</InlineFeedback>}
    {(phase === 'refused' || phase === 'failed') && <>
      <InlineFeedback tone="error">{detail}</InlineFeedback>
      {phase === 'failed' && <FgButton type="button" variant="secondary" disabled={!createInvite || !request.trim()} onClick={() => { void prepare() }}>Retry</FgButton>}
    </>}
    {/* The last successful design stays visible across every later phase — generating, a
        clarification request, or a failure never remove a card the parent already has. */}
    {result?.art && <InvitationCard key={`${result.provenance.promptHash}:${result.art.base64.length}`} result={{ ...result, art: result.art }} mode={mode} />}
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

export function InvitationCard({ result, mode = 'mock' }: {
  result: InviteResponse & { art: NonNullable<InviteResponse['art']> }; mode?: 'mock' | 'live'
}) {
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
