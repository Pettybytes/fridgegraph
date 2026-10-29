async page => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const directory = 'web/evidence/shell'
  const checks = []
  const verify = (condition, message) => { if (!condition) throw new Error(message); checks.push(message) }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('http://127.0.0.1:4173/')
  await page.getByRole('heading', { name: 'Mission Control', exact: true }).waitFor()
  await page.screenshot({ path: directory + '/01-desktop-shell-1440.png', fullPage: true })
  verify(await page.getByText('Fictional demo', { exact: true }).isVisible(), 'Desktop shell explicitly labels the fictional demo')
  await page.getByRole('link', { name: 'Living Village', exact: true }).click()
  await page.getByRole('heading', { name: 'Living Village', exact: true }).waitFor()
  verify(await page.getByRole('region', { name: 'Living Village workspace' }).isVisible(), 'Living Village route slot is visible')
  verify(await page.getByRole('link', { name: 'Living Village', exact: true }).getAttribute('aria-current') === 'page', 'Village navigation marks the current route')
  await page.screenshot({ path: directory + '/02-desktop-village-slot-1440.png', fullPage: true })
  await page.getByRole('link', { name: 'Parent chat', exact: true }).click()
  await page.getByRole('heading', { name: 'Parent chat', exact: true }).waitFor()
  await page.screenshot({ path: directory + '/03-desktop-parent-chat-slot-1440.png', fullPage: true })
  await page.goBack()
  await page.getByRole('heading', { name: 'Living Village', exact: true }).waitFor()
  checks.push('Parent chat navigation and browser Back restore the correct route')
  await page.reload()
  await page.getByRole('heading', { name: 'Living Village', exact: true }).waitFor()
  checks.push('Direct village hash route survives reload')

  await page.evaluate(async () => {
    const reactModule = await import('/node_modules/.vite/deps/react.js')
    const React = reactModule.default ?? reactModule
    const domModule = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { createRoot } = domModule.default ?? domModule
    const { DataProvider, useSurfaceData } = await import('/src/lib/frontendData/provider.tsx')
    const { createMockAdapter, demoScope } = await import('/src/lib/frontendData/mockAdapter.ts')
    const { reasonLabel, TRAVEL_COST_LABEL } = await import('/src/lib/frontendData/types.ts')
    const adapter = createMockAdapter()
    const originalRead = adapter.readMissionControl
    const probe = { reads: 0, timestamps: [], ready: false, candidates: [], pending: reasonLabel('PENDING'), overPolicy: reasonLabel('OVER_POLICY'), label: TRAVEL_COST_LABEL }
    adapter.readMissionControl = async scope => {
      probe.reads++
      probe.timestamps.push(Date.now())
      return originalRead(scope)
    }
    const host = document.createElement('div')
    host.hidden = true
    document.body.append(host)
    const root = createRoot(host)
    function Probe() {
      const result = useSurfaceData('mission-control')
      React.useEffect(() => {
        if (result.data) {
          probe.ready = true
          probe.candidates = result.data.frontendSnapshot.candidates
        }
      }, [result.data])
      return null
    }
    window.__shellAdapterProbe = probe
    window.__cleanupShellAdapterProbe = () => { root.unmount(); host.remove() }
    root.render(React.createElement(DataProvider, { adapter, scope: demoScope }, React.createElement(Probe)))
  })
  await page.waitForFunction(() => window.__shellAdapterProbe?.ready && window.__shellAdapterProbe.reads >= 2, null, { timeout: 8000 })
  const adapter = await page.evaluate(() => {
    const result = window.__shellAdapterProbe
    window.__cleanupShellAdapterProbe()
    delete window.__cleanupShellAdapterProbe
    delete window.__shellAdapterProbe
    return result
  })
  verify(adapter.reads === 2, 'Real browser Apollo poll performs exactly two adapter reads after one interval')
  const interval = adapter.timestamps[1] - adapter.timestamps[0]
  verify(interval >= 2400 && interval < 4000, 'Real browser polling interval is approximately 2500 ms')
  verify(adapter.candidates.length === 4, 'Adapter returns four recorded real-seed caregivers')
  verify(adapter.pending === 'Waiting for reply' && adapter.overPolicy === 'Over your travel limit', 'Waiting and travel-limit labels follow the approved wording')
  verify(adapter.label === 'Estimated travel cost', 'Cost label is Estimated travel cost')
  verify(adapter.candidates.every(candidate => Math.abs(candidate.estimatedRideCostUsd - candidate.distanceMiles * 1.4) < .005), 'Synthetic travel estimate uses $1.40 per mile for every caregiver')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('link', { name: 'Mission Control', exact: true }).click()
  await page.getByRole('heading', { name: 'Mission Control', exact: true }).waitFor()
  await page.screenshot({ path: directory + '/04-mobile-shell-390.png', fullPage: true })
  verify(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '390px shell has no horizontal overflow')
  await page.getByRole('link', { name: 'Living Village', exact: true }).click()
  await page.getByRole('heading', { name: 'Living Village', exact: true }).waitFor()
  await page.screenshot({ path: directory + '/05-mobile-village-slot-390.png', fullPage: true })
  verify(await page.getByRole('region', { name: 'Living Village workspace' }).isVisible(), '390px village slot is visible')
  verify(errors.length === 0, 'No browser page errors')
  return { checks, adapterReads: adapter.reads, measuredPollIntervalMs: interval, viewports: ['1440×1000', '390×844'], screenshots: 5, errors }
}
