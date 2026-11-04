import type {ReactNode} from 'react'
import {Dialog} from 'radix-ui'
import {formatInstant} from '@/features/calendar/time'
import type {ResponseEntry} from './adapter'
import {OrbitConfetti} from './OrbitConfetti'

export function OrbitResolution({recipient=false, childName, thankyou, closedAt, ownResponses=[], celebrate=false, parentConfirmed=false, factsCard, closerName}: {
  recipient?: boolean
  childName?: string
  thankyou?: string | null
  closedAt?: string | null
  ownResponses?: ResponseEntry[]
  celebrate?: boolean
  parentConfirmed?: boolean
  // The parent keeps the full record: the green facts card (photo, name, tiles) renders inside the
  // green payoff. The recipient view passes neither, so its closed screen stays sanitized.
  factsCard?: ReactNode
  closerName?: string | null
}) {
  return <section className="orbit-found" data-celebrating={celebrate || undefined} aria-label="Found safe" aria-live={celebrate ? 'polite' : 'off'}>
    {celebrate && <><div className="orbit-safe-reveal" aria-hidden="true"/><div className="orbit-safe-halo" aria-hidden="true"/><OrbitConfetti/></>}
    <span className="orbit-safe-mark">
      <span className="orbit-safe-ring" aria-hidden="true"/>
      <svg className="orbit-safe-check" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/><path d="M27 51 43 67 75 34" pathLength="1"/></svg>
    </span>
    {recipient && childName && <p className="orbit-found-name">{childName.trim().split(/\s+/)[0]}</p>}
    {recipient ? <Dialog.Description asChild><h2>Found safe</h2></Dialog.Description> : <h2>Found safe</h2>}
    {factsCard}
    <p className="orbit-thankyou">{thankyou ?? 'Thank-you not recorded.'}</p>
    {!recipient && (closerName
      ? <p className="orbit-found-closer">Closed by {closerName}{closedAt ? ` · ${formatInstant(closedAt)}` : ''}</p>
      : <p>{parentConfirmed ? 'You confirmed found safe' : 'Closed by a parent or guardian'}{closedAt ? ` · ${formatInstant(closedAt)}` : ''}</p>)}
    {recipient && ownResponses.map(response => <p key={`${response.respondedAt}:${response.response}`}>Your response: {response.response === 'WITH_ME' ? 'reported with me' : response.response === 'ON_WAY' ? 'on my way' : 'cannot help'} · {formatInstant(response.respondedAt)}</p>)}
  </section>
}
