/**
 * FridgeGraph's brand mark — a French-door fridge silhouette, replacing the placeholder
 * `Sprout` icon (lucide-react) at every brand-mark consumer (sidebar/header, persona picker,
 * favicon). See docs/brand/README.md for the full design rationale and export set.
 *
 * Two deliberate optical sizes, not one drawing scaled for every size (design contract, this
 * PR's brief): `FridgeMarkSimple` drops the heart and bumps the stroke for 16px contexts
 * (the favicon); `FridgeMark` is the full mark — silhouette, center seam, two handles, one heart
 * magnet — for the 24–40px contexts where the detail actually reads (sidebar/header, persona
 * picker). Matches lucide's own API shape (`size`, forwarded SVG props) and rendering
 * conventions (24×24 viewBox, round caps/joins, `stroke="currentColor"`) so it sits beside the
 * unchanged lucide nav icons without a visual seam of its own. Uses only the existing indigo
 * brand color via `currentColor` — no new color is introduced.
 */
import * as React from 'react'

type FridgeMarkProps = React.SVGProps<SVGSVGElement> & { size?: number | string }

/** The 16px-optimized mark: silhouette, seam, handles. No heart — it would be an illegible
 * blob at favicon scale. Stroke is a touch heavier than the detailed mark for small-size clarity. */
export function FridgeMarkSimple({ size = 24, ...props }: FridgeMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size}
      fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round"
      {...props}
    >
      <rect x="4" y="2" width="16" height="20" rx="3" />
      <path d="M12 2v20" />
      <path d="M10.3 6v4.3" />
      <path d="M13.7 6v4.3" />
    </svg>
  )
}

/** The full mark, for 24–40px contexts: adds the heart magnet on the lower-left door. */
export function FridgeMark({ size = 24, ...props }: FridgeMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size}
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      {...props}
    >
      <rect x="4" y="2" width="16" height="20" rx="3" />
      <path d="M12 2v20" />
      <path d="M10.4 6v4" />
      <path d="M13.6 6v4" />
      <path
        d="M8.3 16.74s-1.76-1.1-1.76-2.42a1.1 1.1 0 0 1 1.76-.88 1.1 1.1 0 0 1 1.76.88c0 1.32-1.76 2.42-1.76 2.42Z"
        fill="currentColor" stroke="none"
      />
    </svg>
  )
}
