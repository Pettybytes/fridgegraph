import type { StoryEvent, Viewer } from './story'

const viewNames: Record<Viewer, { label: string; name: string; surface: string; nav: readonly string[] }> = {
  parent: { label: 'Parent', name: 'Kendra', surface: 'Today · Nora', nav: ['Today', 'Village', 'Activity'] },
  caregiver: { label: 'Caregiver', name: 'Loretta', surface: 'Pickup requests', nav: ['Requests', 'Village'] },
  teacher: { label: 'Teacher', name: 'Ms. Whitfield', surface: 'School day', nav: ['School day', 'Pickup'] },
}

export function PhoneReplay({ viewer, events, voicePeaks }: { viewer: Viewer; events: readonly StoryEvent[]; voicePeaks?: readonly number[] }) {
  const meta = viewNames[viewer]
  return <figure className={`sr-view sr-view--${viewer}`} data-viewer={viewer}>
    <div className="sr-card">
      <div className="sr-card-image" aria-hidden="true" />
      <div className="sr-phone" aria-label={`${meta.label} perspective` }>
        <span className="sr-side-button sr-side-button--top" aria-hidden="true" />
        <span className="sr-side-button sr-side-button--bottom" aria-hidden="true" />
        <div className="sr-screen">
          <div className="sr-camera" aria-hidden="true" />
          <div className="sr-statusbar" aria-hidden="true"><span>9:41</span><span>●●● ▰</span></div>
          <div className="sr-appbar"><span><strong>FridgeGraph</strong><small>{meta.surface}</small></span></div>
          <div className="sr-screen-body">
            <p className="sr-day">Friday, October 30, 2026</p>
            <div className="sr-message-list" aria-label={`${meta.label} story events`}>
              {events.length === 0 && <p className="sr-wait">The story is about to begin.</p>}
              {events.slice(-3).map(event => <article className={`sr-message sr-message--${event.kind}`} key={event.id} data-event-id={event.id}>
                <strong>{event.title}</strong>{event.id === 'offer' && voicePeaks && <div className="sr-waveform" role="img" aria-label="Waveform derived from Loretta’s approved audio">{voicePeaks.map((peak, index) => <span key={index} style={{ height: `${Math.min(100, Math.max(8, peak * 100))}%` }} />)}</div>}<p>{event.body}</p>{event.detail && <small>{event.detail}</small>}
              </article>)}
            </div>
          </div>
          <div className="sr-bottom-nav" aria-hidden="true">{meta.nav.map(item => <span key={item}>{item}</span>)}</div>
        </div>
      </div>
    </div>
    <figcaption><strong>{meta.label}</strong><span aria-hidden="true"> · </span>{meta.name}</figcaption>
  </figure>
}
