import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('sample invitation edits and exports an untainted PNG', async ({ page }, testInfo) => {
  const artRequests: string[] = []
  page.on('request', request => {
    if (request.url().includes('/invites/sample-art.png')) artRequests.push(request.url())
  })
  await page.goto('/invites-preview.html')
  await expect(page.getByText('This is a fixed fictional sample.')).toBeVisible()
  await page.getByRole('button', { name: 'Show sample invitation' }).click()
  const card = page.getByRole('region', { name: 'Invitation card ready' })
  await expect(card).toBeVisible()
  // The DOM honesty line (the short 'Sample art' credit moved into the exported canvas pixels,
  // asserted below via creditPixels).
  await expect(page.getByText('A fixed fixture illustration, not a new generation')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download PNG' })).toBeEnabled()
  const before = await page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL('image/png'))
  await page.getByRole('textbox', { name: 'Occasion' }).fill("Nora's birthday picnic with the whole village")
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', /Nora's birthday picnic with the whole village/)
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL('image/png'))).not.toBe(before)
  expect(artRequests).toHaveLength(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const size = page.viewportSize()!.width === 390 ? 'phone' : 'desktop'
  await page.screenshot({ path: testInfo.outputPath(`${size}-light.png`), fullPage: true })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: testInfo.outputPath(`${size}-dark.png`), fullPage: true })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PNG' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('invitation-nora.png')
  const path = testInfo.outputPath(`${size}-export.png`)
  await download.saveAs(path)
  const png = await readFile(path)
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(png.readUInt32BE(16)).toBe(1024)
  expect(png.readUInt32BE(20)).toBe(1024)
  expect(png.byteLength).toBeGreaterThan(40_000)
  const creditPixels = await page.evaluate(async base64 => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(400, 884, 224, 40).data
    let dark = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 90 && pixels[index + 1] < 90 && pixels[index + 2] < 110) dark++
    }
    return dark
  }, png.toString('base64'))
  expect(creditPixels).toBeGreaterThan(50)
})
