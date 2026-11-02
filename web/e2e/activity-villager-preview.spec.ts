import { expect, test } from '@playwright/test'

test('Activity shows an Add-a-Villager confirmation as who-confirmed-it + what was granted', async ({ page }, testInfo) => {
  await page.goto('/activity-preview.html')
  await expect(page.getByText('Preview — fictional sample data, no live reads.')).toBeVisible()
  await expect(page.getByText('Added Dana Coleman — pickup access.')).toBeVisible()
  await expect(page.getByText('Kendra')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open in Village' })).toHaveAttribute('href', '#/village')

  const size = page.viewportSize()!.width === 390 ? 'phone' : 'desktop'
  await page.screenshot({ path: testInfo.outputPath(`${size}.png`), fullPage: true })
})
