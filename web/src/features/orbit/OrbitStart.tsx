import {useState} from 'react'
import {Camera, MapPin, Send, Check} from 'lucide-react'
import {descriptorKeys, vocabularyKinds} from './adapter'
import type {Descriptors, Vocabulary} from './adapter'
import {descriptorLabels} from './OrbitPreparation'
import {useOrbitState, useOrbitPhoto} from './runtime'
import type {OrbitController} from './controller'

/**
 * Pull the controlled-vocabulary details out of the parent's free-text description. This is a
 * deterministic match against the child's recorded vocabulary (no LLM, no browser credential): a
 * value counts only when it appears as a whole word, longest value first so "light blue" wins over
 * "blue". The parent never picks from a wall of dropdowns; they just describe the child.
 */
export function extractDescriptors(text: string, vocabulary: Vocabulary[]): Descriptors {
  const hay = text.toLowerCase()
  const out: Descriptors = {}
  for (const key of descriptorKeys) {
    const match = vocabulary
      .filter(v => v.kind === vocabularyKinds[key])
      .sort((a, b) => b.value.length - a.value.length)
      .find(v => {
        const word = v.value.toLowerCase().replaceAll('_', ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`\\b${word}\\b`).test(hay)
      })
    if (match) out[key] = match.value
  }
  return out
}

/**
 * The frantic-parent START screen, on the Orbit page itself (not inside Ask Rosina). Rosina leads
 * with empathy, the parent types one description, the photo is one optional real button, and a
 * single Send Orbit alert drafts, previews and activates in one step. No form, no review page.
 */
export function OrbitStart({controller, childName}: {controller: OrbitController; childName: string}) {
  const state = useOrbitState(controller)
  const image = useOrbitPhoto(controller, state.busy === 'upload' ? undefined : state.photoId)
  const [text, setText] = useState('')
  const [place, setPlace] = useState('')
  const firstName = childName.trim().split(/\s+/)[0] || 'your child'
  const sending = state.busy === 'preview' || state.busy === 'activate' || ['preparing', 'activating'].includes(state.phase)
  const uploading = state.busy === 'upload'
  const described = text.trim().length > 0
  const summary = described ? extractDescriptors(text, state.vocabulary) : {}
  const placeLabel = state.places.find(p => p.id === place)?.label
  const send = () => {
    if (!described || sending) return
    void controller.sendAlert({values: extractDescriptors(text, state.vocabulary), lastSeenPlaceId: place || undefined, lastSeenAt: new Date().toISOString()})
  }
  return <section className="orbit-start" aria-label="Start an Orbit alert">
    <div className="orbit-start-lead">
      <span className="orbit-start-rosina" aria-hidden="true">R</span>
      <p><strong>Rosina</strong><span>I'm here. Tell me what's happening, and I'll help you find {firstName}.</span></p>
    </div>
    <label className="orbit-start-field">
      <span className="sr-only">Describe {firstName}</span>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} disabled={sending}
        placeholder={`Describe ${firstName}: what they look like, what they had on, and where you last saw them.`}/>
    </label>
    <div className="orbit-start-controls">
      <label className={`orbit-add-photo${state.photoId ? ' is-added' : ''}`}>
        {state.photoId ? <Check size={18}/> : <Camera size={18}/>}{uploading ? 'Adding photo…' : state.photoId ? 'Photo added' : 'Add a photo'}
        <input type="file" accept="image/jpeg,image/png" disabled={sending} onChange={e => {const f = e.target.files?.[0]; if (f) void controller.uploadPhoto(f); e.target.value = ''}}/>
      </label>
      {state.places.length > 0 && <label className="orbit-start-place">
        <MapPin size={18}/>
        <select value={place} onChange={e => setPlace(e.target.value)} disabled={sending} aria-label="Where last seen">
          <option value="">Where last seen</option>
          {state.places.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>}
    </div>
    {image.url && <img className="orbit-start-thumb" src={image.url} alt="Photo you added" onError={image.onError}/>}
    {described && <dl className="orbit-start-summary" aria-label="What will be sent">
      <div><dt>Last seen</dt><dd>{placeLabel ?? 'add a place if you can'} · just now</dd></div>
      {descriptorKeys.filter(k => summary[k]).map(k => <div key={k}><dt>{descriptorLabels[k]}</dt><dd>{summary[k]!.replaceAll('_', ' ')}</dd></div>)}
    </dl>}
    {state.error && <p className="orbit-start-error" role="alert">{state.error}</p>}
    <button type="button" className="orbit-primary orbit-send" disabled={!described || sending} onClick={send}>
      <Send size={18}/>{sending ? 'Sending Orbit alert…' : 'Send Orbit alert'}
    </button>
    <p className="orbit-start-note">I'll do everything I can to help you find {firstName}. Only approved test responders are contacted.</p>
  </section>
}
