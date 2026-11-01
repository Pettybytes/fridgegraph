/**
 * FridgeMark — the FridgeGraph brand mark. Hand-authored SVG: a fridge door with a
 * freezer divider, two handles, and a magnet holding a note (the family fridge, where
 * the village's plans live). Replaces the earlier lucide plant.
 *
 * The body uses `currentColor` so it inherits ink in light and dark; the note + magnet
 * carry the brand accents. Drawn on a 24-grid with bold strokes so it stays legible at
 * 16px as well as at hero size. Decorative by default (aria-hidden); pass `title` to
 * expose it as an image with an accessible name.
 */
export function FridgeMark({ size = 24, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      className={className}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {/* fridge body */}
      <rect x="5" y="2.6" width="14" height="18.8" rx="3.2" stroke="currentColor" strokeWidth="1.8" />
      {/* freezer / fridge divide */}
      <path d="M5.4 8.7h13.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {/* door handles */}
      <path d="M8 4.8v2.1M8 11.1v3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {/* a note held by a magnet on the lower door */}
      <rect x="11.3" y="12.4" width="4.7" height="5.3" rx="1" fill="var(--fg-primary, #4b3fd6)" />
      <circle cx="13.65" cy="12.4" r="1.15" fill="var(--fg-accent, #e8633f)" stroke="currentColor" strokeWidth="0.7" />
    </svg>
  )
}
