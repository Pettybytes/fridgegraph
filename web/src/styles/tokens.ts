/**
 * Shared design tokens for the places JavaScript needs a value (Motion springs,
 * canvas/SVG rendering in the village graph, z-index logic).
 *
 * The COLOR palette's one authoritative definition is `web/src/index.css`. This
 * module never re-declares colours — `readToken()` resolves them from the live
 * CSS custom properties, so JS always follows the current theme (light/dark)
 * and there is no second, divergent palette to drift. Bound by
 * docs/contracts/design.md.
 */

/** Runtime CSS custom-property names (the authoritative palette lives in CSS). */
export const token = {
  canvas: '--fg-canvas',
  surface: '--fg-surface',
  elevated: '--fg-elevated',
  ink: '--fg-ink',
  mutedInk: '--fg-muted',
  hairline: '--fg-border',
  brand: '--fg-primary',
  onBrand: '--fg-on-primary',
  coral: '--fg-accent',
  selection: '--fg-selection',
  focus: '--fg-focus',
  onWay: '--fg-onway',
  withMe: '--fg-withme',
  simulated: '--fg-simulated',
  real: '--fg-real',
  attention: '--fg-attention',
  rosinaPeriwinkle: '--rosina-periwinkle',
  rosinaViolet: '--rosina-violet',
  rosinaNavy: '--rosina-navy',
  rosinaSilver: '--rosina-silver',
} as const

export type TokenName = (typeof token)[keyof typeof token]

/**
 * Resolve a token to its current computed colour string (follows light/dark).
 * `el` lets a caller scope the read to a subtree; defaults to the document root.
 * Returns '' during SSR / before mount, so callers should have a sane fallback.
 */
export function readToken(name: TokenName, el?: Element): string {
  if (typeof window === 'undefined') return ''
  const scope = el ?? document.documentElement
  return getComputedStyle(scope).getPropertyValue(name).trim()
}

/** Motion durations in ms (design.md §4). Feedback ≤160; panels 180–260; one scene ≤320. */
export const duration = {
  feedback: 140,
  panel: 220,
  scene: 300,
} as const

/** Custom easing curves (Emil's; design.md §4). Never ease-in on UI. */
export const easing = {
  out: [0.23, 1, 0.32, 1] as const,
  inOut: [0.77, 0, 0.175, 1] as const,
  drawer: [0.32, 0.72, 0, 1] as const,
}

export const easingCss = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const

/**
 * Motion spring presets. Default is critically damped (no overshoot); `momentum`
 * adds a little bounce and is reserved for gesture/flick-driven motion only
 * (apple-design §4). Durations are in seconds for Motion's bounce+duration API.
 */
export const spring = {
  default: { type: 'spring', bounce: 0, duration: 0.3 },
  panel: { type: 'spring', bounce: 0, duration: 0.4 },
  momentum: { type: 'spring', bounce: 0.2, duration: 0.4 },
} as const

/** z-index scale — mirrors the CSS --z-* tokens; no arbitrary values. */
export const z = {
  base: 0,
  raised: 10,
  sticky: 20,
  nav: 30,
  overlay: 40,
  modal: 50,
  toast: 60,
} as const
