// Evidence capture for the Orbit alert cards. Renders the REAL OrbitView/AlertTakeover through the
// controlled offline review harness (web/scripts/orbit-alert-review.html) — no backend, no auth.
// Every file in this directory is written by this script.
//   node web/evidence/orbit-cards/capture.mjs
import {chromium} from '@playwright/test'
import {mkdirSync, renameSync, rmSync} from 'node:fs'
import path from 'node:path'

const OUT = path.dirname(new URL(import.meta.url).pathname)
const BASE = 'http://127.0.0.1:5199/scripts/orbit-alert-review.html?mode=recipient'
mkdirSync(OUT, {recursive: true})
const videoDir = path.join(OUT, '.video')
rmSync(videoDir, {recursive: true, force: true})
mkdirSync(videoDir, {recursive: true})

const browser = await chromium.launch()
let backendCalls = 0
const note = (page) => page.on('request', (r) => {
  const u = new URL(r.url())
  if (/\/(api|graphql)(\/|$)/.test(u.pathname)) backendCalls += 1
})

async function shot(page, name) {
  await page.screenshot({path: path.join(OUT, name)})
  console.log(`wrote ${name}`)
}

/** Structural checks the screenshot alone cannot state: no clipped text, no sideways overflow,
 *  touch targets at 44px, and both requested rings present. */
async function assertContainment(page, label) {
  const report = await page.evaluate(() => {
    const clipped = []
    for (const sel of ['.orbit-alert-facts h2', '.orbit-glass-heading h2', '.orbit-found h2', '.orbit-thankyou', '.orbit-alert-facts p']) {
      for (const el of document.querySelectorAll(sel)) {
        // Horizontal spill is clipping. Vertical overflow is not: a large heading with a 1.05
        // line-height reports scrollHeight > clientHeight for glyph extents and still renders whole,
        // and the takeover scrolls rather than clips.
        if (el.scrollWidth > el.clientWidth + 1) clipped.push(sel)
      }
    }
    const small = [...document.querySelectorAll('.orbit-alert-actions button, .orbit-takeover header button')]
      .map((b) => b.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 44).length
    return {
      clipped,
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      smallTargets: small,
      statusRings: document.querySelectorAll('.orbit-constellation-ring').length,
      safeRings: document.querySelectorAll('.orbit-safe-ring').length,
      confetti: document.querySelectorAll('.orbit-particle').length,
    }
  })
  console.log(`${label}: ${JSON.stringify(report)}`)
  return report
}

async function openActive(page) {
  await page.goto(BASE)
  await page.getByRole('dialog').waitFor()
  await page.getByAltText('Photo shared by the parent').waitFor()
  await page.waitForFunction(() => document.querySelector('.orbit-alert-subject img')?.complete)
  await page.waitForTimeout(400)
}

const setDark = (page, dark) => page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark)

/** ACTIVE (light, dark) and FOUND SAFE (light, dark) at one viewport. */
async function captureBothStates(context, prefix) {
  const page = await context.newPage()
  note(page)
  await openActive(page)
  await shot(page, `${prefix}-active.png`)
  const active = await assertContainment(page, `${prefix}-active`)
  await setDark(page, true)
  await page.waitForTimeout(250)
  await shot(page, `${prefix}-active-dark.png`)
  const activeDark = await assertContainment(page, `${prefix}-active-dark`)
  await setDark(page, false)
  await page.evaluate(() => window.dispatchEvent(new Event('controlled:close')))
  await page.getByText('Found safe', {exact: true}).waitFor()
  await page.waitForTimeout(380)
  await shot(page, `${prefix}-found-safe-confetti.png`)
  const found = await assertContainment(page, `${prefix}-found-safe-confetti`)
  await page.waitForTimeout(1100)
  await shot(page, `${prefix}-found-safe.png`)
  await setDark(page, true)
  await page.waitForTimeout(250)
  await shot(page, `${prefix}-found-safe-dark.png`)
  const foundDark = await assertContainment(page, `${prefix}-found-safe-dark`)
  await page.close()
  return {active, activeDark, found, foundDark}
}

// ---------------------------------------------------------------- desktop
const desktop = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 2})
const desktopReports = await captureBothStates(desktop, 'desktop')
await desktop.close()

// Detail view: the subject + response actions below the fold on a 900px-tall window.
const detail = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 2})
const detailPage = await detail.newPage()
note(detailPage)
await openActive(detailPage)
await detailPage.locator('.orbit-alert-subject').scrollIntoViewIfNeeded()
await detailPage.waitForTimeout(250)
await shot(detailPage, 'desktop-active-detail.png')
await detail.close()

// ---------------------------------------------------------------- phone
const phone = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 3})
const phoneReports = await captureBothStates(phone, 'phone')
await phone.close()

// ---------------------------------------------------------------- transition recording (light)
const recorder = await browser.newContext({
  viewport: {width: 1440, height: 900},
  recordVideo: {dir: videoDir, size: {width: 1440, height: 900}},
})
const recording = await recorder.newPage()
note(recording)
await openActive(recording)
await recording.waitForTimeout(700)
await recording.evaluate(() => window.dispatchEvent(new Event('controlled:close')))
await recording.getByText('Found safe', {exact: true}).waitFor()
await recording.waitForTimeout(2200)
const confettiDuringClose = await recording.locator('.orbit-particle').count()
const video = recording.video()
await recorder.close()
if (video) {
  renameSync(await video.path(), path.join(OUT, 'active-to-found-safe.webm'))
  console.log('wrote active-to-found-safe.webm')
}
rmSync(videoDir, {recursive: true, force: true})

await browser.close()
const reports = {...desktopReports, ...phoneReports}
const broken = Object.values(reports).some((r) => r.clipped.length || r.sideways || r.smallTargets)
console.log(JSON.stringify({backendCalls, confettiDuringClose, reports}, null, 2))
if (backendCalls || broken || desktopReports.active.statusRings < 2 || desktopReports.found.safeRings < 1 || confettiDuringClose === 0) {
  console.error('FAIL: capture checks did not hold')
  process.exit(1)
}
