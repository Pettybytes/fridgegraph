import { expect, test } from '@playwright/test'

test('standalone judge checklist is readable, inert, and reopenable', async ({ page }, testInfo) => {
  const apiRequests: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()) })
  await page.goto('/demo-checklist-preview.html')
  await expect(page.getByRole('heading', { name: 'Judge checklist' })).toBeVisible()
  await expect(page.getByText(/historical October 26, 2026 sample/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Notice and pickup receipt' })).toHaveAttribute('href', /docs\/evidence\/67-rosina-notice-briefing-live\.md$/)
  await expect(page.getByRole('heading', { name: 'Talk to Rosina' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Review photo suggestions' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const size = page.viewportSize()!.width === 390 ? 'phone' : 'desktop'
  await page.screenshot({ path: testInfo.outputPath(`${size}-light.png`), fullPage: true })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: testInfo.outputPath(`${size}-dark.png`), fullPage: true })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await page.getByRole('button', { name: 'Dismiss checklist' }).click()
  await expect(page.getByRole('button', { name: 'Reopen judge checklist' })).toBeVisible()
  await page.getByRole('button', { name: 'Reopen judge checklist' }).click()
  await expect(page.getByRole('heading', { name: 'Judge checklist' })).toBeVisible()
  expect(apiRequests).toHaveLength(0)
})

test('guide preview shows only the read-only path', async ({ page }, testInfo) => {
  await page.goto('/demo-checklist-preview.html?guide=1')
  await expect(page.getByText('Demo guide · read-only exploration')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Explore read-only' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'A school notice changes the plan' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reset demo and checklist' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath(page.viewportSize()!.width === 390 ? 'guide-phone.png' : 'guide-desktop.png'), fullPage: true })
})
