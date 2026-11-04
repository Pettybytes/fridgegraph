import { expect, test, type Locator } from '@playwright/test'

// Expected subsets are derived independently from actual authorized API responses.
// Never save storage state, request headers, tokens or a network trace.
type Job = { id: string; type: string; status: string; confirmation?: { id: string } | null }
type Target = { kind: string; value?: string; from?: string; through?: string }
const day = (at: string | number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
const status = (job: Job) => ({ pending: 'Request recorded', discovering: 'Coordination in progress', awaiting_approval: 'Waiting for parent approval', confirmed: job.confirmation?.id ? 'Parent approval recorded' : 'Approval evidence missing', failed: 'Coordination ended' })[job.status] ?? 'Recorded status not recognized'
const tiles: Record<string, Target> = {
  'Requests over 30 days': { kind: 'requests' }, 'Contact coverage': { kind: 'contact', value: 'recorded' },
  'Status mix': { kind: 'requests' }, 'Requests by weekday': { kind: 'requests' },
  'Parent approvals': { kind: 'approval' }, 'Open items': { kind: 'open' },
}

declare global { interface Window { __pulseTiming?: { started: number; rendered: number | null } } }

async function measureClickToRecords(locator: Locator, wanted: string[]) {
  await locator.evaluate((element, ids) => {
    window.__pulseTiming = undefined
    element.addEventListener('click', () => {
      const timing = { started: performance.now(), rendered: null as number | null }
      window.__pulseTiming = timing
      const observer = new MutationObserver(() => {
        const panel = document.querySelector('[aria-label="Selected pulse records"]')
        if (!panel || !panel.getBoundingClientRect().height) return
        const actual = [...panel.querySelectorAll('[data-pulse-record-id]')].map(row => row.getAttribute('data-pulse-record-id')!).sort()
        if (JSON.stringify(actual) !== JSON.stringify(ids)) return
        timing.rendered = performance.now() - timing.started
        observer.disconnect()
      })
      observer.observe(document.querySelector('.vp')!, { childList: true, subtree: true, attributes: true })
    }, { once: true, capture: true })
  }, wanted)
}

async function pointerClick(locator: Locator) {
  await locator.scrollIntoViewIfNeeded()
  // Use an actual painted SVG point. The center of a donut's bounding box is its hole.
  const point = await locator.evaluate(element => {
    if (!(element instanceof SVGGeometryElement)) return null
    const box = element.getBBox(), matrix = element.getScreenCTM()
    if (!matrix) throw new Error('Chart has no screen transform')
    for (let x = .025; x < 1; x += .05) for (let y = .025; y < 1; y += .05) {
      const local = new DOMPoint(box.x + box.width * x, box.y + box.height * y)
      if (!element.isPointInFill(local)) continue
      const screen = local.matrixTransform(matrix)
      if (document.elementFromPoint(screen.x, screen.y) === element) return { x: screen.x, y: screen.y }
    }
    throw new Error('No clickable painted point found')
  })
  if (point) await locator.page().mouse.click(point.x, point.y)
  else await locator.click()
}

test('every tile, chart segment, bucket and daily count opens exact records within 3 seconds', async ({ page }, info) => {
  const jobs = new Map<string, Job>(), created = new Map<string, string>(), contacts = new Map<string, boolean>()
  let latestOrbit: { alertId?: string; status?: string } | null = null
  page.on('response', async response => {
    const request = response.request()
    if (!request.url().includes('/graphql') || request.method() !== 'POST') return
    const body = request.postDataJSON() as { operationName?: string; variables?: { jobId?: string } }
    if (!body.operationName?.startsWith('Web')) return
    const payload = await response.json().catch(() => null)
    if (body.operationName === 'WebCoordinationJobs') for (const job of payload?.data?.coordinationJobs ?? []) jobs.set(job.id, job)
    if (body.operationName === 'WebStoredTimeline') {
      const moment = payload?.data?.jobTimeline?.find((item: { kind: string; at: string }) => item.kind === 'JOB_CREATED' && Number.isFinite(Date.parse(item.at)))
      if (moment) created.set(body.variables!.jobId!, moment.at)
    }
    if (body.operationName === 'WebStoredAttempts') contacts.set(body.variables!.jobId!, (payload?.data?.attempts ?? []).some((item: { at: string }) => Number.isFinite(Date.parse(item.at))))
    if (body.operationName === 'WebOrbitStatus') latestOrbit = payload?.data?.orbitStatus ?? null
  })
  await page.goto('/#/mission-control')
  const loginResponse = page.waitForResponse(response => response.url().includes('/api/demo/login'))
  await page.getByRole('button', { name: 'Explore as Kendra', exact: true }).click()
  const login = await loginResponse
  expect(login.status(), 'Demo login must be healthy before checking drilldowns').toBe(200)
  expect((await login.json()).status).toBe('READY')
  await page.getByRole('navigation', { name: 'Main navigation' }).waitFor({ timeout: 20_000 })
  const first = page.getByRole('button', { name: 'View Requests over 30 days records', exact: true })
  await expect(first, 'Served build must expose the request drilldown').toBeVisible({ timeout: 30_000 })
  const through = day(Date.now())
  const fromDate = new Date(`${through}T12:00:00Z`); fromDate.setUTCDate(fromDate.getUTCDate() - 29)
  const from = fromDate.toISOString().slice(0, 10)
  expect(jobs.size, 'API must supply a nonempty caller-visible history').toBeGreaterThan(0)
  const expected = (target: Target) => {
    const current = ['pending', 'open', 'orbit'].includes(target.kind)
    const lower = target.from ?? from, upper = target.through ?? through
    const result = [...jobs.values()].filter(job => {
      if (job.type !== 'PICKUP' || target.kind === 'orbit') return false
      const at = created.get(job.id), date = at ? day(at) : null
      if (!current && (!date || date < lower || date > upper)) return false
      switch (target.kind) {
        case 'contact': return contacts.get(job.id) === (target.value === 'recorded')
        case 'status': return status(job) === target.value
        case 'weekday': return date && (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7 === Number(target.value)
        case 'approval': return target.value === 'approved' ? !!job.confirmation?.id : target.value === 'pending' ? job.status === 'awaiting_approval' && !job.confirmation?.id : !!job.confirmation?.id || job.status === 'awaiting_approval'
        case 'pending': case 'open': return job.status === 'awaiting_approval' && !job.confirmation?.id
        default: return true
      }
    }).map(job => job.id)
    if ((target.kind === 'orbit' || target.kind === 'open') && latestOrbit?.status === 'ACTIVE' && latestOrbit.alertId) result.push(latestOrbit.alertId)
    return result.sort()
  }
  const url = page.url()
  // One memory-only sign-in covers both sizes without doubling shared demo-login traffic.
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844 }]) await test.step(viewport.name, async () => {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await expect(page.locator('.vp-mobile-nav')).toBeVisible({ visible: viewport.name === 'phone' })
  let actions = 0, slowest = 0
  for (const panel of viewport.name === 'phone' ? [0, 1] : [0]) {
    if (panel) await page.getByRole('button', { name: 'Next pulse panel' }).click()
    // Opening the daily table must not reset when coming back from a record selection.
    const daily = page.locator('.vp-daily')
    if (await daily.isVisible() && !(await daily.evaluate(element => !!element.closest('[inert]'))) && (await daily.getAttribute('open')) === null) await daily.locator('summary').click()
    const candidates = page.locator('.vp-overview [data-pulse-action], .vp-overview [data-pulse-tile]')
    for (let index = 0; index < await candidates.count(); index++) {
      const action = candidates.nth(index)
      if (!(await action.isVisible()) || await action.evaluate(element => !!element.closest('[inert]'))) continue
      const tile = await action.getAttribute('data-pulse-tile')
      const target = tile ? tiles[tile] : JSON.parse((await action.getAttribute('data-pulse-action'))!) as Target
      const wanted = expected(target)
      await action.scrollIntoViewIfNeeded()
      // Start at the actual browser click, excluding automation's scrolling/hit-point discovery.
      await measureClickToRecords(action, wanted)
      await pointerClick(action)
      const records = page.getByRole('region', { name: 'Selected pulse records' })
      await expect(records).toBeVisible({ timeout: 3000 })
      await expect.poll(async () => (await records.locator('[data-pulse-record-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-pulse-record-id')!).sort())), { timeout: 3000, message: `Exact records for ${tile ?? JSON.stringify(target)}` }).toEqual(wanted)
      await expect.poll(() => page.evaluate(() => window.__pulseTiming?.rendered ?? null), { timeout: 3000 }).not.toBeNull()
      const elapsed = await page.evaluate(() => window.__pulseTiming!.rendered!)
      expect(elapsed, 'Click to reconciled records must take under 3 seconds').toBeLessThan(3000)
      slowest = Math.max(slowest, elapsed); actions++
      if (actions % 30 === 0) console.log(`${viewport.name}: ${actions} clicks reconciled`)
      if (actions === 1 && wanted.length) {
        const row = records.locator('details').first()
        await row.locator('summary').click()
        await expect(row.getByRole('region').locator('[data-pulse-moment-kind=JOB_CREATED]')).toHaveText('Pickup request recorded', { timeout: 3000 })
      }
      await records.getByRole('button', { name: 'Back to Village pulse' }).click()
      await expect(first).toBeVisible({ visible: viewport.name !== 'phone' || panel === 0 })
      expect(page.url()).toBe(url)
      if (viewport.name === 'phone') await expect(page.getByRole('button', { name: panel ? 'Show Weekdays and open items' : 'Show Requests and status' })).toHaveAttribute('aria-current', 'step')
      if (await daily.isVisible()) await expect(daily).toHaveAttribute('open', '')
    }
  }
  expect(actions).toBeGreaterThan(35)
  console.log(`${viewport.name}: ${actions} actual clicks reconciled, slowest ${slowest}ms`)
  await page.locator('.vp').screenshot({ path: info.outputPath(`${viewport.name}-pulse.png`) })
  expect(await page.locator('.vp').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  })
})
