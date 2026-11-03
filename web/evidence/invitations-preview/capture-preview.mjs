import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const OUT = '/Users/user/orca/workspaces/fridgegraph/feat-fridge-notes/web/evidence/invitations-preview'
mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5201/invites-preview.html'
const out = { base: BASE, at: new Date().toISOString(), runs: [] }
const browser = await chromium.launch()

async function run(width, height, label) {
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const btn = page.getByRole('button', { name: /Show sample invitation/i })
  await btn.click()
  await page.waitForTimeout(1500)
  const text = await page.locator('body').innerText()
  const canvas = await page.locator('canvas').count()
  const readout = await page.locator('.invites-card__readout').innerText().catch(() => '')
  await page.screenshot({ path: `${OUT}/${label}-invitations-preview.png`, fullPage: false })
  out.runs.push({ label, viewport: `${width}x${height}`, canvas, readout, text: text.slice(0, 600), errors })
  console.log(label, JSON.stringify({ canvas, lines: readout.split('\n').filter(Boolean).length, credit: /Sample art — not generated/.test(text), errors: errors.length }))
  await page.close()
}

await run(1440, 900, 'desktop')
await run(390, 844, 'phone')
await browser.close()
writeFileSync(`${OUT}/preview-results.json`, JSON.stringify(out, null, 2) + '\n')
console.log('WROTE', OUT)
