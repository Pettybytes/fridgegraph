import { expect, test, type Page } from '@playwright/test'
import { personas } from '../src/features/personas/auth'

/**
 * Pristine gate (Bryan, 2026-11-03): "No unable to load's ever again."
 *
 * Loads every navigable page as EVERY persona and fails if any failure-state or
 * gated-read string renders on the happy path. Run it against the served build:
 *
 *   PRISTINE_BASE_URL=http://127.0.0.1:5189 npx playwright test -c playwright.pristine.config.ts
 *
 * Every persona runs at desktop (1440x900); the two reference parents (kendra, dana)
 * also run the full walk at 390x844.
 *
 * The page list is DISCOVERED from the rendered main navigation per persona, so a
 * new page is covered the day it ships and a persona-specific nav is respected.
 */

// Strings that must never render on a happy path, for any persona (case-insensitive;
// both straight and curly apostrophes).
const FORBIDDEN: RegExp[] = [
  /couldn['’]t load/i,
  /couldn['’]t check/i,
  /unable to load/i,
  /not available in this view/i,
  /unavailable/i,
  /try again later/i,
  /something went wrong/i,
  /page not found/i,
]

const SETTLE_MS = 2200

async function walkAllPages(page: Page, personaName: string) {
  await page.goto('/')
  await page.getByRole('button', { name: personaName }).or(page.locator(`button:has-text("${personaName}")`)).first().click({ timeout: 15_000 })
  await page.waitForSelector('nav[aria-label="Main navigation"]', { timeout: 20_000 })
  const hrefs = await page.$$eval('nav[aria-label="Main navigation"] a', (as) => as.map((a) => a.getAttribute('href') ?? ''))
  expect(hrefs.length, 'main navigation must list pages').toBeGreaterThan(0)
  const failures: string[] = []
  for (const href of hrefs) {
    await page.goto('/' + href)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(SETTLE_MS)
    const text = await page.innerText('body')
    for (const re of FORBIDDEN) {
      const m = text.match(re)
      if (m) {
        const i = text.indexOf(m[0])
        failures.push(`${href}: "${m[0]}" in …${text.slice(Math.max(0, i - 50), i + 60).replace(/\s+/g, ' ')}…`)
      }
    }
  }
  expect(failures, failures.join('\n')).toEqual([])
}

for (const persona of personas) {
  test(`every page is pristine as ${persona.id} (desktop)`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await walkAllPages(page, persona.name)
  })
}

for (const id of ['kendra', 'dana'] as const) {
  const persona = personas.find((p) => p.id === id)
  if (!persona) throw new Error(`reference persona ${id} missing from the roster`)
  test(`every page is pristine as ${id} (390x844)`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await walkAllPages(page, persona.name)
  })
}
