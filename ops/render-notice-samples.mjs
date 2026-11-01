/**
 * Render the fictional Notice → Plan sample documents from their exact HTML into PNG and PDF so the
 * on-page text is EXACT (never model-generated). Playwright + headless Chromium only; no network,
 * no credentials, no live service. Output is committed as static assets the "Try a sample" tray
 * fetches by URL (documented in docs/contracts/notice-plan.md §7).
 *
 *   node ops/render-notice-samples.mjs
 *
 * Add a sample by appending to SAMPLES. Keep the .html the single source of truth for the text.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src/rosina/samples');
const OUT = resolve(here, '../web/public/samples/notice-plan');

const SAMPLES = [
  { id: 'notice-a-early-dismissal', html: 'notice-a-early-dismissal.html' },
  { id: 'notice-b-ambiguous', html: 'notice-b-ambiguous.html' },
  { id: 'notice-c-field-trip', html: 'notice-c-field-trip.html' },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const sample of SAMPLES) {
      const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
      await page.goto('file://' + resolve(SRC, sample.html), { waitUntil: 'networkidle' });
      const el = await page.$('.page');
      await el.screenshot({ path: resolve(OUT, `${sample.id}.png`) });
      await page.pdf({
        path: resolve(OUT, `${sample.id}.pdf`),
        printBackground: true,
        width: '8.5in',
        height: '11in',
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      });
      await page.close();
      console.log(`rendered ${sample.id} -> ${sample.id}.png, ${sample.id}.pdf`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
