import { expect, test } from '@playwright/test'
test('navigation, caregiver selection and explicit simulated approval', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: "Nora's afternoon pickup" })).toBeVisible()
  await page.getByRole('link', { name: 'Living Village', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Living Village workspace' })).toBeVisible()
  await page.getByRole('link', { name: 'Mission Control', exact: true }).click()
  await page.getByRole('button', { name: 'Select Loretta Brooks' }).click()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Over your travel limit')
  await expect(page.getByRole('dialog')).toContainText('Estimated travel cost')
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Replay recorded approval' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close review' }).click()
  await page.getByRole('button', { name: 'Approve pickup' }).click()
  await expect(page.getByRole('dialog')).toContainText('Simulated demo')
  await page.getByRole('button', { name: 'Replay recorded approval' }).click()
  await expect(page.getByRole('status')).toHaveText('Parent approval recorded')
  await expect(page.getByText(/conf_0003/)).toBeVisible()
  await expect(page.getByText('Approval is recorded. Pickup completion has not been recorded.')).toBeVisible()
})

for (const openerName of ['Approve pickup', 'Review']) {
  for (const dismissal of ['Escape', 'Close']) {
    test(`dialog restores ${openerName} focus after ${dismissal}`, async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: "Nora's afternoon pickup" })).toBeVisible()
      const opener = page.getByRole('button', { name: openerName, exact: true })
      await opener.click()
      const dialog = page.getByRole('dialog', { name: 'Review Tasha Ellison', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveAccessibleName('Review Tasha Ellison')
      await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
      await expect(page.getByRole('heading', { name: 'Mission Control', exact: true })).toHaveCount(0)
      await expect(page.getByRole('status')).toHaveCount(0)
      if (dismissal === 'Escape') await page.keyboard.press('Escape')
      else await dialog.getByRole('button', { name: 'Close review', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
      await expect(page.getByRole('heading', { name: 'Mission Control', exact: true })).toBeVisible()
      await expect(page.getByRole('status')).toHaveText('Awaiting parent approval')
    })
  }
}
