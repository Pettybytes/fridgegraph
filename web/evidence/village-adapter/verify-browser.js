async page => {
  await page.goto('http://127.0.0.1:4181/')
  await page.getByRole('link', { name: 'Living Village', exact: true }).click()
  await page.getByRole('region', { name: 'Living Village workspace' }).waitFor()
  const adapter = await page.evaluate(async () => {
    const { createMockAdapter, demoScope } = await import('/src/lib/frontendData/mockAdapter.ts')
    const adapter = createMockAdapter()
    const graph = await adapter.readVillage(demoScope)
    let rejected = false
    try { await adapter.readVillage({ ...demoScope, villageId: 'other' }) }
    catch (error) { rejected = error.message === 'UNAUTHORIZED' }
    return { nodes: graph.nodes.length, edges: graph.edges.length, rejected, safe: !/"(?:address|lat|lng|coordinates|contactMethods|value)"/.test(JSON.stringify(graph)) }
  })
  if (adapter.nodes !== 8 || adapter.edges !== 7 || !adapter.rejected || !adapter.safe) throw new Error('Village adapter validation failed')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'web/evidence/village-adapter/desktop-1440.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'web/evidence/village-adapter/mobile-390.png', fullPage: true })
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  if (!noOverflow) throw new Error('Mobile horizontal overflow')
  return { adapter, viewports: ['1440×1000', '390×844'], noOverflow, slotVisible: await page.getByRole('region', { name: 'Living Village workspace' }).isVisible(), note: 'Hermes export absent; existing route slot retained' }
}
