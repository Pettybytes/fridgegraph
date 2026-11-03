import { expect, test, type Page, type TestInfo } from '@playwright/test'

/**
 * Judge-path smoke test.
 *
 * Runs the end-to-end "judge" walkthrough against ANY running instance. Point it at a base URL
 * with JUDGE_BASE_URL (see playwright.judge.config.ts):
 *
 *   JUDGE_BASE_URL=http://localhost:5189 npx playwright test -c playwright.judge.config.ts
 *   JUDGE_BASE_URL=https://<public-host> npx playwright test -c playwright.judge.config.ts
 *
 * With JUDGE_BASE_URL unset it spins up the local dev server (port 4182).
 *
 * READ-ONLY BY DEFAULT. It navigates, opens read affordances, and screenshots every step. It never
 * confirms a proposal and never mutates. The proposal walkthrough is a separate, opt-in test gated
 * behind JUDGE_PROPOSAL=1 (see bottom of file) because creating a proposal can persist data and spend
 * model credits — run it only in an explicitly authorized window.
 *
 * ERROR GATE. The run FAILS on unexpected first-party console errors, failed requests, HTTP >= 400
 * responses, and GraphQL errors embedded in HTTP 200 responses. Expected negatives are declared
 * NARROWLY below, each keyed to a specific operation/path/status with a reason — we do not globally
 * ignore authorization or network failures. Every observed negative (expected or not) is logged.
 */

const SHOT_DIR = process.env.JUDGE_SHOTS_DIR // optional absolute dir for step screenshots

// ---- Narrowly-declared expected negatives (known baseline for the current deploy) -------------
// Keep these as tight as possible: a NEW/different error of the same category must still fail.

// Known map fallback: OpenFreeMap vector tiles are a third-party host and are expected to abort in
// this environment (the map degrades to its documented fallback). Recorded, not globally ignored.
const isKnownMapTile = (url: string) => { try { return new URL(url).hostname === 'tiles.openfreemap.org' } catch { return false } }

// GraphQL operations that return HTTP 400 on the current deployed subgraph set. Narrow by op name.
const EXPECTED_HTTP_ERROR_OPS = new Set<string>([
  // Activity's villager-additions query is rejected (400) by the deployed village subgraph.
  'WebActivityVillagerAdditions',
])

// GraphQL field errors embedded in HTTP 200 responses that are INTENDED per-perspective refusals.
// Matched by field path + code so an unexpected authz error elsewhere still fails.
const EXPECTED_GQL_FIELD_ERRORS: { path: string; code: string }[] = [
  { path: 'householdMembers', code: 'UNAUTHORIZED' },
]

// Console lines that are the direct, generic echo of an allowed HTTP 400 above (Chrome logs a bare
// "Failed to load resource: ... 400 (Bad Request)" with no URL). Allowed only in that exact form.
const isGeneric400ConsoleLine = (text: string) =>
  /Failed to load resource: the server responded with a status of 400 \(Bad Request\)/.test(text)

// -----------------------------------------------------------------------------------------------

type Negative = { kind: string; detail: string; expected: boolean; reason?: string }

function opNameOf(postData: string | null): string[] {
  if (!postData) return []
  try {
    const j = JSON.parse(postData)
    return Array.isArray(j) ? j.map((x: { operationName?: string }) => x.operationName ?? '') : [j.operationName ?? '']
  } catch { return [] }
}

function attachGate(page: Page, origin: string) {
  const negatives: Negative[] = []
  const add = (n: Negative) => negatives.push(n)

  page.on('console', m => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (isGeneric400ConsoleLine(text)) add({ kind: 'console', detail: text, expected: true, reason: 'echo of allowed HTTP 400' })
    else add({ kind: 'console', detail: text, expected: false })
  })

  page.on('pageerror', e => add({ kind: 'pageerror', detail: e.message, expected: false }))

  page.on('requestfailed', r => {
    const url = r.url()
    const err = r.failure()?.errorText ?? ''
    const detail = `${r.method()} ${url} :: ${err}`
    let firstPartyGraphql = false
    try { firstPartyGraphql = new URL(url).origin === origin && /\/graphql(\b|$)/.test(url) } catch { /* */ }
    // ERR_ABORTED is a client-initiated cancellation, not a network failure. Allow it only for the
    // map-tile fallback and for first-party GraphQL reads the app intentionally aborts on navigation
    // / persona switch. Any other failure (DNS, refused, timeout, non-abort) still fails the gate.
    if (isKnownMapTile(url)) add({ kind: 'requestfailed', detail, expected: true, reason: 'known map tile fallback (third-party)' })
    else if (err === 'net::ERR_ABORTED' && firstPartyGraphql) add({ kind: 'requestfailed', detail, expected: true, reason: 'in-flight GraphQL read cancelled on navigation/persona switch' })
    else add({ kind: 'requestfailed', detail, expected: false })
  })

  page.on('response', async r => {
    const url = r.url()
    const status = r.status()
    const ops = opNameOf(r.request().postData())
    if (status >= 400) {
      const expected = ops.some(op => EXPECTED_HTTP_ERROR_OPS.has(op))
      add({ kind: 'http-error', detail: `${status} ${url} op=${ops.join(',')}`, expected, reason: expected ? 'known 400 operation' : undefined })
      return
    }
    if (status === 200 && /\/graphql(\b|$)/.test(url)) {
      let body: unknown
      try { body = await r.json() } catch { return }
      const errs = (Array.isArray(body) ? body : [body]).flatMap((x: { errors?: unknown[] }) => (x && x.errors) ?? [])
      for (const e of errs as { message?: string; path?: unknown[]; extensions?: { code?: string } }[]) {
        const leaf = Array.isArray(e.path) ? String(e.path[e.path.length - 1]) : ''
        const code = e.extensions?.code ?? ''
        const expected = EXPECTED_GQL_FIELD_ERRORS.some(x => x.path === leaf && x.code === code)
        add({ kind: 'graphql-200-error', detail: `op=${ops.join(',')} path=${leaf} code=${code} msg=${e.message ?? ''}`, expected, reason: expected ? 'intended per-field authz refusal' : undefined })
      }
    }
  })

  return negatives
}

async function shot(page: Page, info: TestInfo, name: string) {
  const path = SHOT_DIR ? `${SHOT_DIR}/${name}.png` : info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
}

function report(negatives: Negative[]) {
  const expected = negatives.filter(n => n.expected)
  const unexpected = negatives.filter(n => !n.expected)
  console.log('\n### JUDGE-PATH observed negatives')
  console.log(`expected (declared, allowed): ${expected.length}`)
  for (const n of expected) console.log(`  [OK] ${n.kind}: ${n.detail}  -- ${n.reason}`)
  console.log(`unexpected (fail): ${unexpected.length}`)
  for (const n of unexpected) console.log(`  [FAIL] ${n.kind}: ${n.detail}`)
  return unexpected
}

test('judge read-only path: picker → Kendra → surfaces → Demo guide', async ({ page, baseURL }, info) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:4182').origin
  const negatives = attachGate(page, origin)

  // 1. Picker loads with the persona cards (portraits/avatars).
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /The village it takes to raise a child/ })).toBeVisible()
  await expect(page.locator('button.fg-pcard')).not.toHaveCount(0)
  await expect(page.locator('button[aria-label="Explore as Kendra"]')).toBeVisible()
  await expect(page.locator('button[aria-label="Explore as the Demo guide"]')).toBeVisible()
  await shot(page, info, '01-picker')

  // 2. Sign in as Kendra.
  await page.locator('button[aria-label="Explore as Kendra"]').click()
  await expect(page.locator('.session-chip')).toContainText('Kendra')
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()

  // 3. Today + the judge checklist.
  await page.goto('/#/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Judge checklist' })).toBeVisible()
  await shot(page, info, '02-today-judge-checklist')

  // 4. The Fridge — overview + both doors.
  await page.goto('/#/fridge')
  await expect(page.getByRole('heading', { name: 'The Fridge', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open collage door' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open goals door' })).toBeVisible()
  await shot(page, info, '03-fridge-overview')
  await page.getByRole('button', { name: 'Open collage door' }).click()
  await shot(page, info, '04-fridge-collage-door')
  await page.goto('/#/fridge')
  await page.getByRole('button', { name: 'Open goals door' }).click()
  await expect(page.getByRole('heading', { name: 'Our goals' })).toBeVisible()
  await shot(page, info, '05-fridge-goals-door')

  // 5. Ask Rosina page renders.
  await page.goto('/#/ask-rosina')
  await expect(page.getByRole('heading', { name: 'Ask Rosina' }).first()).toBeVisible()
  await expect(page.locator('[aria-label="Rosina conversation"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Explain this screen' })).toBeVisible()
  await shot(page, info, '06-ask-rosina')

  // 6. Mission Control + Village pulse.
  await page.goto('/#/mission-control')
  await expect(page.getByRole('heading', { name: 'Mission Control', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Village pulse' })).toBeVisible()
  await shot(page, info, '07-mission-control')

  // 7. Activity.
  await page.goto('/#/activity')
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible()
  await shot(page, info, '08-activity')

  // 8. Orbit.
  await page.goto('/#/orbit')
  await expect(page.getByRole('heading', { name: 'Orbit', exact: true })).toBeVisible()
  await shot(page, info, '09-orbit')

  // 9. Switch to the Demo guide — read-only, no edit controls.
  await page.getByRole('button', { name: 'Switch perspective' }).first().click()
  await page.locator('button[aria-label="Explore as the Demo guide"]').click()
  await expect(page.locator('.session-chip')).toContainText('Demo guide is read-only')
  await page.goto('/#/mission-control')
  await expect(page.getByRole('heading', { name: 'Mission Control', exact: true })).toBeVisible()
  // No mutating/edit controls are offered to the guide.
  await expect(page.getByRole('button', { name: 'Approve pickup' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Confirm/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Replay recorded approval' })).toHaveCount(0)
  await shot(page, info, '10-demo-guide-mission-control')

  // Error gate.
  const unexpected = report(negatives)
  expect(unexpected, `unexpected negatives:\n${unexpected.map(n => `${n.kind}: ${n.detail}`).join('\n')}`).toEqual([])
})

// Proposal walkthrough — OPT-IN. Stops at the proposal; never confirms. Enable in an authorized
// window with JUDGE_PROPOSAL=1 (creating a proposal can persist data and spend model credits).
// Documented in docs/evidence (see PR notes). Selectors follow the RosinaPanel "Review … proposal"
// → "Confirm …" pattern; the operator should verify the entry point in their hosting window.
test('proposal walkthrough: up to the proposal, never confirm', async ({ page }, info) => {
  test.skip(process.env.JUDGE_PROPOSAL !== '1', 'read-only by default; set JUDGE_PROPOSAL=1 in an authorized window')
  const origin = new URL((test.info().project.use.baseURL as string) ?? 'http://127.0.0.1:4182').origin
  const negatives = attachGate(page, origin)

  await page.goto('/')
  await page.locator('button[aria-label="Explore as Kendra"]').click()
  await expect(page.locator('.session-chip')).toContainText('Kendra')
  await page.goto('/#/ask-rosina')
  await expect(page.getByRole('region', { name: 'Rosina conversation' })).toBeVisible()

  // Advance to a proposal via the sample ("Try a sample") entry, then STOP. We assert a review/
  // proposal affordance appears and that a Confirm control exists but is never clicked.
  const sample = page.getByRole('button', { name: /Try a sample|Try it|Sample/ }).first()
  await sample.click({ timeout: 15_000 })
  const review = page.getByRole('button', { name: /^Review / }).first()
  await expect(review).toBeVisible({ timeout: 60_000 })
  await review.click()
  const confirm = page.getByRole('button', { name: /^Confirm/ })
  await expect(confirm.first()).toBeVisible()
  await shot(page, info, '11-proposal-reached')
  // Intentionally do NOT click confirm. End here.
  const unexpected = report(negatives)
  expect(unexpected).toEqual([])
})
