import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
afterEach(cleanup)

// jsdom implements neither of these; @ilamy/calendar's scrolling time grid and
// mobile-adaptive layout call them. No-op/stub polyfills keep component renders
// from throwing under the test environment without changing behaviour.
const g = globalThis as unknown as Record<string, unknown>
// Guard on Element: some suites opt into the node environment, where it is undefined.
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}
if (!g.matchMedia) g.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })
if (!g.ResizeObserver) g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
