import {useEffect, useRef, useState} from 'react'
import {Portrait} from '@/components/signature/Portrait'
import {formatInstant} from '@/features/calendar/time'
import type {Alert, ResponseChoice} from './adapter'
import '@/components/signature/signature.css'

const responseCopy: Record<ResponseChoice, string> = {
  ON_WAY: 'On my way',
  WITH_ME: 'Reported: with me',
  CANNOT_HELP: "Can't help",
}
const positions = [
  {left: '15%', top: '30%'}, {left: '82%', top: '24%'},
  {left: '9%', top: '67%'}, {left: '91%', top: '66%'},
  {left: '33%', top: '8%'}, {left: '67%', top: '88%'},
  {left: '35%', top: '91%'}, {left: '66%', top: '10%'},
]

export function OrbitConstellation({alert, childName, childPortrait, parent, viewerId, portraitFor}: {
  alert: Alert
  childName: string
  childPortrait?: string
  parent: boolean
  viewerId: string
  portraitFor: (id: string) => string | undefined
}) {
  const people = alert.audience.filter(member => member.eligible && (parent || member.person.id === viewerId))
  const responses = alert.latestResponses.filter(response => people.some(member => member.person.id === response.person.id))
  const responseKey = responses.map(response => `${response.person.id}:${response.respondedAt}:${response.response}`).join('|')
  const seen = useRef<string | null>(null)
  const seenAlert = useRef(alert.id)
  const [fresh, setFresh] = useState<string[]>([])
  useEffect(() => {
    if (seenAlert.current !== alert.id) { seenAlert.current = alert.id; seen.current = responseKey; setFresh([]); return }
    if (seen.current === null) { seen.current = responseKey; return }
    const previous = new Set(seen.current.split('|'))
    const changed = responses.filter(response => !previous.has(`${response.person.id}:${response.respondedAt}:${response.response}`)).map(response => response.person.id)
    seen.current = responseKey
    if (!changed.length) return
    setFresh(changed)
    const timer = window.setTimeout(() => setFresh([]), 850)
    return () => window.clearTimeout(timer)
  }, [alert.id, responseKey])
  const name = childName.trim().split(/\s+/)[0] || 'Child'
  return <section className="orbit-constellation" aria-label="Recorded Orbit audience and responses">
    <div className="orbit-constellation-field">
      <div className="orbit-constellation-ring orbit-constellation-ring-one" aria-hidden="true" />
      <div className="orbit-constellation-ring orbit-constellation-ring-two" aria-hidden="true" />
      <svg className="orbit-connectors" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{people.slice(0, positions.length).map((member, index) => responses.some(item => item.person.id === member.person.id) && <line key={member.person.id} x1={parseFloat(positions[index].left)} y1={parseFloat(positions[index].top)} x2="50" y2="50" data-fresh={fresh.includes(member.person.id) || undefined}/>)}</svg>
      <div className="orbit-constellation-center">
        <span className="orbit-constellation-face"><Portrait name={name} src={childPortrait}/></span>
        <strong>{name}</strong>
        <span>Orbit active</span>
      </div>
      {people.slice(0, positions.length).map((member, index) => {
        const response = responses.find(item => item.person.id === member.person.id)
        const label = response ? responseCopy[response.response as ResponseChoice] ?? 'Response recorded' : 'No response yet'
        const displayName = member.person.displayName || response?.person.displayName || 'Name not shared'
        return <div className="orbit-satellite" data-response={response?.response ?? 'PENDING'} data-fresh={fresh.includes(member.person.id) || undefined} style={positions[index]} key={member.person.id}>
          <Portrait name={displayName} src={displayName === 'Name not shared' ? undefined : portraitFor(member.person.id)}/>
          <span>{displayName}</span>
          <small>{label}</small>
        </div>
      })}
    </div>
    <div className="orbit-constellation-ledger">
      <h3>{parent ? 'Village responses' : 'Your response'}</h3>
      {people.length ? <ul>{people.map(member => {
        const response = responses.find(item => item.person.id === member.person.id)
        const name = member.person.displayName || response?.person.displayName || 'Name not shared'
        return <li key={member.person.id} data-response={response?.response ?? 'PENDING'} data-fresh={fresh.includes(member.person.id) || undefined}>
          <Portrait name={name} src={name === 'Name not shared' ? undefined : portraitFor(member.person.id)}/>
          <div><strong>{name}</strong><span>{response ? responseCopy[response.response as ResponseChoice] ?? 'Response recorded' : 'No response yet'}</span>{response && <time dateTime={response.respondedAt}>{formatInstant(response.respondedAt)}</time>}</div>
        </li>
      })}</ul> : <p>No audience records are shared with this view.</p>}
      {responses.some(response => response.response === 'WITH_ME') && <p className="orbit-report-note">“With me” is a caregiver report. The parent decides when to close Orbit.</p>}
    </div>
  </section>
}
