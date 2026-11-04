import { memo } from 'react'
import {
  ACTIVITY_AT_MS, HOME_UNTIL_MS, LORETTA_PIN_AT_MS, METRIC_AT_MS, PLAN_CONFIRMED_AT_MS,
  STORY_DATE_LABEL, journeyAt, routeProgress, traceAt, traceClock,
  type JourneyEvent, type JourneyKind, type TraceTag,
} from './story'
import { LORETTA_PEAKS } from './narration'
import mapUrl from './assets/village-map-real.webp'
import '@/components/fg/cards.css'

/** Journey kind → design-v2 card type (docs/contracts/design.md §12) for the accent bar. */
const KIND_TYPE: Record<JourneyKind, string> = {
  notice: 'school', rosina: 'rosina', 'parent-action': 'safe', request: 'pickup',
  reply: 'pickup', confirmed: 'safe', today: 'pending',
}

function PhoneShell({ label, surface, children }: { label: string; surface: string; children: React.ReactNode }) {
  return <div className="sr-phone" aria-label={`${label} replay phone`}>
    <span className="sr-side-button sr-side-button--top" aria-hidden="true" />
    <span className="sr-side-button sr-side-button--bottom" aria-hidden="true" />
    <div className="sr-screen">
      <div className="sr-camera" aria-hidden="true" />
      <div className="sr-statusbar" aria-hidden="true"><span>1:30</span><span>●●● ▰</span></div>
      <div className="sr-appbar"><span><strong>FridgeGraph</strong><small>{surface}</small></span><span className="sr-replay-chip">Replay</span></div>
      {children}
    </div>
  </div>
}

/** Phone 1: the app home, then Nora's whole path on Kendra's phone. */
export const JourneyPhone = memo(function JourneyPhone({ elapsed }: { elapsed: number }) {
  const events = journeyAt(elapsed)
  const home = elapsed < HOME_UNTIL_MS
  return <PhoneShell label="Parent" surface="Today · Nora">
    <div className="sr-screen-body" data-screen={home ? 'home' : 'journey'}>
      <div className="sr-home" aria-hidden={!home}>
        <p className="sr-home-brand">FridgeGraph</p>
        <p className="sr-home-greeting">Good afternoon, Kendra</p>
        <div className="sr-home-card" data-fgc-type="pending">
          <strong>Today</strong>
          <p>Nora · school 8:15 AM to 3:00 PM</p>
          <small>Pickup recorded for 3:15 PM</small>
        </div>
        <div className="sr-home-nav" aria-hidden="true"><span>Today</span><span>Village</span><span>Activity</span></div>
      </div>
      <div className="sr-journey" aria-hidden={home}>
        <p className="sr-day">{STORY_DATE_LABEL}</p>
        <div className="sr-message-list" aria-label="Kendra’s replayed journey">
          {events.slice(-4).map(event => <JourneyCard key={event.id} event={event} />)}
        </div>
      </div>
    </div>
    <div className="sr-bottom-nav" aria-hidden="true"><span>Today</span><span>Village</span><span>Activity</span></div>
  </PhoneShell>
})

function JourneyCard({ event }: { event: JourneyEvent }) {
  return <article className={`sr-message sr-message--${event.kind}`} data-event-id={event.id} data-fgc-type={KIND_TYPE[event.kind]}>
    <strong>{event.kind === 'parent-action' ? <span className="sr-action-check" aria-hidden="true">✓ </span> : null}{event.title}</strong>
    {event.id === 'reply' && <div className="sr-waveform" role="img" aria-label="Waveform derived from Loretta’s recorded reply">{LORETTA_PEAKS.map((peak, index) => <span key={index} style={{ height: `${Math.min(100, Math.max(8, peak * 100))}%` }} />)}</div>}
    <p>{event.body}</p>
    {event.detail && <small>{event.detail}</small>}
  </article>
}

const TAG_LABEL: Record<TraceTag, string> = {
  school: 'school', muse: 'muse', mcp: 'mcp', router: 'router', coord: 'coord', rosina: 'rosina',
}

/** Minimal deterministic highlighter for the trace lines: strings, numbers, operations. */
export function traceTokens(text: string): { cls: string; value: string }[] {
  const tokens: { cls: string; value: string }[] = []
  const pattern = /("[^"]*")|(\b\d[\d:.-]*\b)|(\b(?:query|mutation|tool|POST)\b)|(\b[A-Z][A-Za-z]*[a-z][A-Za-z]*\b|\b[A-Z][A-Z_]{2,}\b)|(→)/g
  let last = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) tokens.push({ cls: '', value: text.slice(last, match.index) })
    const cls = match[1] ? 'str' : match[2] ? 'num' : match[3] ? 'kw' : match[4] ? 'type' : 'arr'
    tokens.push({ cls, value: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) tokens.push({ cls: '', value: text.slice(last) })
  return tokens
}

/** Phone 2: the call chain under the hood, typed out in sync with Phone 1. */
export const TracePhone = memo(function TracePhone({ elapsed }: { elapsed: number }) {
  const lines = traceAt(elapsed).slice(-8)
  return <PhoneShell label="Under the hood" surface="Rosina · call chain">
    <div className="sr-screen-body sr-terminal" data-ui>
      <div className="sr-terminal-head" aria-hidden="true"><span className="sr-terminal-dot" /><span className="sr-terminal-dot" /><span className="sr-terminal-dot" /><span>rosina-agent · trace</span></div>
      <ol className="sr-terminal-lines" aria-label="Replayed call chain">
        {lines.map(({ line, chars, typing }) => <li key={line.id} data-tag={line.tag}>
          <span className="sr-t">{traceClock(line.atMs)}</span>
          <span className="sr-tag">{TAG_LABEL[line.tag]}</span>
          <code>{traceTokens(line.text.slice(0, chars)).map((token, index) => token.cls ? <span key={index} className={`sr-tk-${token.cls}`}>{token.value}</span> : token.value)}{typing && <span className="sr-caret" aria-hidden="true" />}</code>
        </li>)}
      </ol>
    </div>
  </PhoneShell>
})

/**
 * The pickup route as a fixed polyline over the REAL captured Village map
 * (assets/village-map-real.webp, intrinsic 390x440). Loretta -> school -> Nora's home,
 * following streets on the real map. Coordinates are in the image's own space.
 */
const ROUTE_POINTS: readonly (readonly [number, number])[] = [
  [66, 252], [120, 250], [122, 168], [196, 164], [202, 112],
  [204, 164], [214, 210], [214, 258], [214, 300],
]
const ROUTE_PATH = ROUTE_POINTS.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
const SEGMENT_LENGTHS = ROUTE_POINTS.slice(1).map((point, index) => Math.hypot(point[0] - ROUTE_POINTS[index][0], point[1] - ROUTE_POINTS[index][1]))
const ROUTE_LENGTH = SEGMENT_LENGTHS.reduce((sum, length) => sum + length, 0)

export function routePoint(progress: number): readonly [number, number] {
  let remaining = Math.min(1, Math.max(0, progress)) * ROUTE_LENGTH
  for (let index = 0; index < SEGMENT_LENGTHS.length; index += 1) {
    const length = SEGMENT_LENGTHS[index]
    if (remaining <= length || index === SEGMENT_LENGTHS.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, remaining / length)
      const [ax, ay] = ROUTE_POINTS[index], [bx, by] = ROUTE_POINTS[index + 1]
      return [ax + (bx - ax) * t, ay + (by - ay) * t]
    }
    remaining -= length
  }
  return ROUTE_POINTS[ROUTE_POINTS.length - 1]
}

/** Phone 3: the village map route, then the Activity entry, then the Mission Control metric. */
export const OutcomePhone = memo(function OutcomePhone({ elapsed }: { elapsed: number }) {
  const progress = routeProgress(elapsed)
  const [dotX, dotY] = routePoint(progress)
  const requested = elapsed >= LORETTA_PIN_AT_MS
  const confirmed = elapsed >= PLAN_CONFIRMED_AT_MS
  const showActivity = elapsed >= ACTIVITY_AT_MS
  const showMetric = elapsed >= METRIC_AT_MS
  const status = showActivity ? null : confirmed ? 'Plan confirmed · tracing the pickup route' : requested ? 'Request with Loretta · waiting on replies' : 'Pickup route · waiting for a plan'
  return <PhoneShell label="Village" surface="Village map · pickup">
    <div className="sr-screen-body sr-outcome">
      <img className="sr-map-base" src={mapUrl} alt="" aria-hidden="true" />
      <svg className="sr-map" viewBox="0 0 390 440" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Replay over the real Village map: the pickup route from Loretta’s place to school to Nora’s home">
        {progress > 0 && <path className="sr-route" d={ROUTE_PATH} pathLength={1} style={{ strokeDashoffset: 1 - progress }} />}
        {progress > 0 && progress < 1 && <circle className="sr-route-dot" cx={dotX} cy={dotY} r="7" />}
        <g className="sr-pin" data-fgc-type="pickup" transform={`translate(${ROUTE_POINTS[0][0]} ${ROUTE_POINTS[0][1]})`} data-active={requested || undefined}>
          <circle r="9" /><text y="25">Loretta</text>
        </g>
        <g className="sr-pin" data-fgc-type="school" transform="translate(202 112)">
          <circle r="9" /><text y="25">School</text>
        </g>
        <g className="sr-pin" data-fgc-type="safe" transform="translate(214 300)" data-active={progress >= 1 || undefined}>
          <circle r="9" /><text y="25">Nora’s home</text>
        </g>
      </svg>
      <div className="sr-outcome-cards">
        {status && <p className="sr-outcome-status" data-confirmed={confirmed || undefined}>{status}</p>}
        {showActivity && <article className="sr-message" data-fgc-type="safe" data-event-id="activity-entry">
          <strong>Activity · CONFIRMED</strong>
          <p>Loretta · a confirmation was recorded.</p>
          <small>1:30 PM · Mission Control</small>
        </article>}
        {showMetric && <article className="sr-message sr-metric" data-fgc-type="pending" data-event-id="mc-metric">
          <strong>Mission Control</strong>
          <p><span className="sr-metric-value">{elapsed >= METRIC_AT_MS + 700 ? 3 : 2}</span> confirmed plans this week</p>
          <small>Updated from the recorded confirmation</small>
        </article>}
      </div>
      <span className="sr-map-credit" aria-hidden="true">Real Village map · © OpenFreeMap · © OpenStreetMap</span>
    </div>
  </PhoneShell>
})
