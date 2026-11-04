import './route-skeleton.css'
/** Static shapes reserve the card space without delaying interaction or adding motion. */
export function RouteSkeleton({ variant = 'cards' }: { variant?: 'cards' | 'calendar' }) {
  return <section className={`route-skeleton route-skeleton-${variant}`} role="status" aria-label="Loading shared records" aria-busy="true">
    <span className="sr-only">Loading shared records</span>
    <div className="route-skeleton-heading" aria-hidden="true" />
    <div className="route-skeleton-grid" aria-hidden="true">{Array.from({ length: variant === 'calendar' ? 7 : 3 }, (_, i) => <div className="route-skeleton-card" key={i}><span /><span /><span /></div>)}</div>
  </section>
}
