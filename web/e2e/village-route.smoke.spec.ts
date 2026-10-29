import { expect, test } from '@playwright/test'
test('village is deferred, all tabs work, and mobile controls leave the canvas clear', async ({ page }) => {
  const villageRequests: string[] = []
  page.on('request', request => {
    if (/\/src\/features\/village\/(index|LivingVillage)\.tsx?/.test(request.url())) villageRequests.push(request.url())
  })
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/src/features/village/index.ts*', async route => { await gate; await route.continue() })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: "Nora's afternoon pickup" })).toBeVisible()
  expect(villageRequests).toHaveLength(0)
  await page.getByRole('link', { name: 'Parent chat', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Parent chat', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Parent chat workspace' })).toBeVisible()
  expect(villageRequests).toHaveLength(0)
  await page.getByRole('link', { name: 'Living Village', exact: true }).click()
  await expect(page.locator('.village-route-loading')).toHaveText('Loading the village…')
  await expect(page.locator('.village-route-loading')).toHaveAttribute('role', 'status')
  release()
  await expect(page.getByRole('img', { name: /Village graph centered on Nora Ellison.*8 people shown/ })).toBeVisible()
  await expect(page.locator('.village-canvas-wrap canvas').first()).toBeVisible()
  expect(villageRequests.length).toBeGreaterThan(0)
  if (page.viewportSize()!.width === 390) {
    const controls = await page.locator('.village-controls').boundingBox()
    const canvas = await page.locator('.village-canvas-wrap').boundingBox()
    expect(controls).not.toBeNull()
    expect(canvas).not.toBeNull()
    expect(controls!.y + controls!.height).toBeLessThanOrEqual(canvas!.y)
  }
  await page.getByRole('button', { name: 'Parents', exact: true }).click()
  await expect(page.getByRole('img', { name: /2 people shown/ })).toBeVisible()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search people in the village' }).fill('Loretta')
  await expect(page.getByRole('img', { name: /1 people shown/ })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search people in the village' }).fill('')
  await expect(page.getByRole('img', { name: /8 people shown/ })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
