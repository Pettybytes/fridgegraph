import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const OUT = '/Users/user/Desktop/bentley/fridgegraph-rosina-conv/web/evidence/rosina-conversation-first'
mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5197'
const out = { base: BASE, at: new Date().toISOString(), runs: [] }
const browser = await chromium.launch()

async function run(width, height, label) {
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Explore as Kendra/ }).click()
  await page.getByRole('heading', { level: 1, name: 'Today' }).waitFor({ timeout: 20000 })
  await page.evaluate(() => { window.location.hash = '#/ask-rosina' })
  await page.waitForTimeout(2500)
  const geometry = await page.evaluate(() => {
    const composer = document.querySelector('form .rosina-composer')?.getBoundingClientRect()
    const notice = document.querySelector('.rosina-notice-attach')?.getBoundingClientRect()
    const thread = document.querySelector('.rosina-thread, [class*="thread"]')?.getBoundingClientRect()
    return {
      composerTop: composer ? Math.round(composer.top) : null,
      noticeTop: notice ? Math.round(notice.top) : null,
      threadTop: thread ? Math.round(thread.top) : null,
      noticeInsideComposer: !!(document.querySelector('form .rosina-composer .rosina-notice-attach')),
      noticeAboveComposer: !!(composer && notice && notice.bottom <= composer.top),
    }
  })
  const text = await page.locator('main').innerText()
  await page.screenshot({ path: `${OUT}/${label}-ask-rosina.png`, fullPage: false })
  out.runs.push({ label, viewport: `${width}x${height}`, geometry, hasComposer: /Message Rosina/.test(text), hasNotice: /notice/i.test(text), errors })
  console.log(label, JSON.stringify(geometry), 'errors', errors.length)
  await page.close()
}

await run(1280, 900, 'desktop')
await run(390, 844, 'phone')
await browser.close()
writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 2) + '\n')
console.log('WROTE', OUT)
