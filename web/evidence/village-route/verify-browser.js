async page => {
  const checks = []
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const verify = (condition, message) => { if (!condition) throw new Error(message); checks.push(message) }
  const results = []
  const directory = 'web/evidence/village-route'
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.goto('about:blank')
    await page.setViewportSize(viewport)
    const chunkRequests = []
    const listener = request => { if (/\/assets\/village-[^/]+\.js/.test(request.url())) chunkRequests.push(request.url()) }
    page.on('request', listener)
    let release = () => {}
    const gate = new Promise(resolve => { release = resolve })
    const intercept = async route => { await gate; await route.continue() }
    await page.route('**/assets/village-*.js', intercept)
    await page.goto('http://127.0.0.1:4185/')
    await page.getByRole('heading', { name: "Nora's afternoon pickup", exact: true }).waitFor()
    verify(chunkRequests.length === 0, `${viewport.width}: production village chunk absent on Mission Control`)
    await page.screenshot({ path: `${directory}/mission-control-${viewport.width}.png`, fullPage: true })
    await page.getByRole('link', { name: 'Parent chat', exact: true }).click()
    await page.getByRole('region', { name: 'Parent chat workspace', exact: true }).waitFor()
    verify(chunkRequests.length === 0, `${viewport.width}: production village chunk absent on Parent chat`)
    await page.screenshot({ path: `${directory}/parent-chat-${viewport.width}.png`, fullPage: true })
    await page.getByRole('link', { name: 'Living Village', exact: true }).click()
    await page.locator('.village-route-loading').waitFor()
    verify(await page.locator('.village-route-loading').getAttribute('role') === 'status', `${viewport.width}: quiet accessible Suspense state`)
    if (viewport.width === 390) await page.screenshot({ path: `${directory}/village-loading-390.png`, fullPage: true })
    release()
    await page.getByRole('img', { name: /Village graph centered on Nora Ellison.*8 people shown/ }).waitFor()
    await page.locator('.village-canvas-wrap canvas').first().waitFor()
    await page.waitForTimeout(2200) // Existing graph's documented 2000ms physics cooldown.
    const controls = await page.locator('.village-controls').boundingBox()
    const canvas = await page.locator('.village-canvas-wrap').boundingBox()
    verify(chunkRequests.length === 1, `${viewport.width}: one village chunk requested after navigation`)
    if (viewport.width === 390) verify(controls.y + controls.height <= canvas.y, '390: search/filter controls finish above the canvas')
    verify(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${viewport.width}: no horizontal overflow`)
    await page.screenshot({ path: `${directory}/living-village-${viewport.width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Parents', exact: true }).click()
    await page.getByRole('img', { name: /2 people shown/ }).waitFor()
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Search people in the village' }).fill('Loretta')
    await page.getByRole('img', { name: /1 people shown/ }).waitFor()
    checks.push(`${viewport.width}: role filter and search work`)
    await page.getByRole('link', { name: 'Mission Control', exact: true }).click()
    await page.getByRole('heading', { name: "Nora's afternoon pickup", exact: true }).waitFor()
    await page.getByRole('link', { name: 'Living Village', exact: true }).click()
    await page.getByLabel('Search people in the village').waitFor()
    verify(chunkRequests.length === 1, `${viewport.width}: route revisit reuses the loaded module`)
    page.off('request', listener)
    await page.unroute('**/assets/village-*.js', intercept)
    results.push({ viewport, villageJsRequests: chunkRequests.length, controls, canvas, mobileControlsClearCanvas: viewport.width === 390 ? controls.y + controls.height <= canvas.y : null })
  }
  verify(errors.length === 0, 'No page errors in production screenshots and interactions')
  return { results, checks, errors, note: 'Parent chat is its existing placeholder; no chat feature is claimed.' }
}
