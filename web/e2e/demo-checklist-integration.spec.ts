import { expect, test } from '@playwright/test'

test('Kendra sees the mounted checklist and can complete the historical notice sample in mock mode', async ({ page }, info) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore as Kendra' }).click()
  await expect(page.getByRole('region', { name: 'Judge checklist' })).toBeVisible()
  await expect(page.getByText(/historical October 26, 2026 sample/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Talk to Rosina' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Review photo suggestions' })).toHaveCount(0)
  const size = page.viewportSize()!.width === 390 ? 'phone' : 'desktop'
  await page.screenshot({ path: info.outputPath(`${size}-parent-top.png`), fullPage: true })
  if (size === 'phone') {
    await page.evaluate(() => { document.getElementById('root')!.scrollTop = 610 })
    await page.screenshot({ path: info.outputPath('phone-parent-checklist.png') })
    await page.evaluate(() => { document.getElementById('root')!.scrollTop = 1030 })
    await page.screenshot({ path: info.outputPath('phone-parent-checklist-end.png') })
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Dismiss checklist' }).click()
  await page.getByRole('button', { name: 'Demo checklist' }).click()
  await expect(page.getByRole('region', { name: 'Judge checklist' })).toBeVisible()

  await page.getByRole('link', { name: 'Ask Rosina' }).click()
  await page.getByText('Add a notice', { exact: true }).click()
  await page.getByRole('button', { name: 'Try a sample' }).click()
  await page.getByRole('button', { name: 'Use early dismissal notice (PNG)' }).click()
  await expect(page.getByText('notice-a-early-dismissal.png')).toBeVisible()
  await page.getByRole('button', { name: 'Review notice' }).click()
  const review = page.getByRole('region', { name: 'Review proposed changes' })
  await expect(review).toContainText('Mock review · No records created')
  await expect(review).toContainText('2026-10-26')
  await expect(review).toContainText('12:30 PM')
  await review.getByRole('button', { name: 'Confirm mock pickup request' }).click()
  await expect(review).toContainText('Mock pickup request shown')
  await expect(review).toContainText('No real record was created, and pickup is not arranged yet.')
})

test('Demo guide sees only its read-only checklist path', async ({ page }, info) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore as the Demo guide' }).click()
  await page.getByRole('link', { name: 'Today' }).click()
  const checklist = page.getByRole('region', { name: 'Judge checklist' })
  await expect(checklist).toContainText('Demo guide · read-only exploration')
  await expect(checklist.getByRole('heading', { name: 'Explore read-only' })).toBeVisible()
  await expect(checklist.getByRole('checkbox')).toHaveCount(1)
  await expect(checklist.getByRole('button', { name: 'Reset shared demo…' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await checklist.screenshot({ path: info.outputPath(page.viewportSize()!.width === 390 ? 'phone-guide.png' : 'desktop-guide.png') })
})
