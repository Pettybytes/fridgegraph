async page => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const checks = []
  const verify = (condition, label) => { if (!condition) throw new Error(label); checks.push(label) }
  const results = []
  const directory = 'web/evidence/mission-control'
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const width = viewport.width
    await page.setViewportSize(viewport)
    await page.goto('http://127.0.0.1:4182/')
    await page.getByRole('heading', { name: "Nora's afternoon pickup", exact: true }).waitFor()
    verify(await page.getByRole('status').textContent() === 'Awaiting parent approval', `${width}: no parent approval before explicit action`)
    verify(await page.getByRole('button', { name: /^Select / }).count() === 4, `${width}: four recorded caregivers`)
    verify(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: no horizontal overflow`)
    await page.screenshot({ path: `${directory}/01-recommendation-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Select Loretta Brooks' }).click()
    const review = page.getByRole('button', { name: 'Review', exact: true })
    await review.click()
    let dialog = page.getByRole('dialog', { name: 'Review Loretta Brooks', exact: true })
    await dialog.waitFor()
    verify((await dialog.textContent()).includes('Over your travel limit'), `${width}: exact over-limit label`)
    verify((await dialog.textContent()).includes('Estimated travel cost'), `${width}: exact travel-cost label`)
    verify(await dialog.getByRole('button', { name: 'Replay recorded approval' }).count() === 0, `${width}: reviewing an alternative is not an approval`)
    await page.screenshot({ path: `${directory}/02-alternative-review-${width}.png` })
    await dialog.getByRole('button', { name: 'Close review' }).click()
    await dialog.waitFor({ state: 'hidden' })
    verify(await review.evaluate(el => el === document.activeElement), `${width}: Close returns focus to Review opener`)
    const opener = page.getByRole('button', { name: 'Approve pickup', exact: true })
    await opener.click()
    dialog = page.getByRole('dialog', { name: 'Review Tasha Ellison', exact: true })
    await dialog.waitFor()
    verify(await dialog.evaluate(el => !!el.getAttribute('aria-labelledby')), `${width}: named recommendation dialog`)
    verify(await dialog.evaluate(el => el.contains(document.activeElement)), `${width}: focus enters dialog`)
    verify(await page.getByRole('heading', { name: 'Mission Control', exact: true }).count() === 0, `${width}: background inaccessible while open`)
    verify((await dialog.textContent()).includes('Simulated demo'), `${width}: approval replay explicitly simulated`)
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press('Tab')
      verify(await dialog.evaluate(el => el.contains(document.activeElement)), `${width}: Tab ${index + 1} stays in dialog`)
    }
    await page.screenshot({ path: `${directory}/03-recommendation-dialog-${width}.png` })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    verify(await opener.evaluate(el => el === document.activeElement), `${width}: Escape returns focus to approval opener`)
    verify(await page.getByRole('heading', { name: 'Mission Control', exact: true }).isVisible(), `${width}: background accessible after Escape`)
    await opener.click()
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Close review' }).click()
    await dialog.waitFor({ state: 'hidden' })
    verify(await opener.evaluate(el => el === document.activeElement), `${width}: Close returns focus to approval opener`)
    await opener.click()
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Replay recorded approval' }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByRole('status').filter({ hasText: 'Parent approval recorded' }).waitFor()
    verify(await page.getByText(/conf_0003/).isVisible(), `${width}: matching recorded Confirmation evidence shown`)
    verify(await page.getByText('Approval is recorded. Pickup completion has not been recorded.').isVisible(), `${width}: approval does not claim pickup completion`)
    verify(await review.evaluate(el => el === document.activeElement), `${width}: removed approval opener falls back to persistent Review button`)
    await page.screenshot({ path: `${directory}/04-approval-recorded-${width}.png`, fullPage: true })
    results.push({ viewport, screenshots: 4, focusRestoration: true, backgroundIsolation: true, approvalEvidence: 'conf_0003' })
  }
  verify(errors.length === 0, 'No browser page errors')
  return { results, checks, pageErrors: errors, scope: 'Explicitly simulated demo only; no live backend or outreach' }
}
