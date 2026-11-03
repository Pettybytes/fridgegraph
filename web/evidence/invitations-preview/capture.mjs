import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const OUT = '/Users/user/orca/workspaces/fridgegraph/feat-fridge-notes/web/evidence/invitations-preview'
mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5198'
const out = { base: BASE, at: new Date().toISOString(), runs: [] }
const browser = await chromium.launch()

async function run(width, height, label) {
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Explore as Kendra/ }).click()
  await page.getByRole('heading', { level: 1, name: 'Today' }).waitFor({ timeout: 20000 })
  await page.evaluate(() => { window.location.hash = '#/invitations' })
  await page.waitForTimeout(1500)
  const box = page.locator('.invites-panel__request textarea')
  if (await box.count()) { await box.fill("Nora's 7th birthday party at Maple Grove Park, Saturday 2-5pm"); await page.getByRole('button', { name: /Show sample invitation|Prepare invitation/ }).click(); await page.waitForTimeout(2500) }
  const text = await page.locator('main').innerText()
  const canvas = await page.locator('canvas').count()
  const img = await page.locator('img').count()
  await page.screenshot({ path: `${OUT}/${label}-invitations.png`, fullPage: false })
  const result = {
    label, viewport: `${width}x${height}`, text: text.slice(0, 800),
    hasSampleLabel: /Sample art — not generated|Sample art - not generated/.test(text),
    hasHost: /Host/i.test(text),
    canvasCount: canvas, imgCount: img, errors,
  }
  out.runs.push(result)
  console.log(label, JSON.stringify({ hasSampleLabel: result.hasSampleLabel, hasHost: result.hasHost, canvas, img, errors: errors.length }))
  await page.close()
}

await run(1440, 900, 'desktop')
await run(390, 844, 'phone')
await browser.close()
writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 2) + '\n')
console.log('WROTE', OUT)
