/**
 * Render the fictional "pin to the fridge" sample documents from exact HTML into PNG + PDF so the
 * text is READABLE IN THE ACTUAL IMAGE/PDF (never a browser-only overlay) — a valid extraction proof.
 * Playwright + headless Chromium only; no model/provider or stack call. Output is committed under
 * web/public/samples/pin/ for the demo "pin a document" flow.
 *
 *   node ops/render-pin-samples.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src/rosina/pin-samples');
const OUT = resolve(here, '../web/public/samples/pin');

const SAMPLES = [
  { id: 'permission-slip', html: 'permission-slip.html', clip: '.page' },
  { id: 'report-card', html: 'report-card.html', clip: '.page' },
  { id: 'appointment-card', html: 'appointment-card.html', clip: '.card' },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const s of SAMPLES) {
      const page = await browser.newPage({ viewport: { width: 880, height: 1120 }, deviceScaleFactor: 2 });
      await page.goto('file://' + resolve(SRC, s.html), { waitUntil: 'networkidle' });
      const el = await page.$(s.clip);
      await el.screenshot({ path: resolve(OUT, `${s.id}.png`) });
      await page.pdf({ path: resolve(OUT, `${s.id}.pdf`), printBackground: true, width: '8.5in', height: '11in', margin: { top: '0', bottom: '0', left: '0', right: '0' } });
      await page.close();
      console.log(`rendered ${s.id} -> ${s.id}.png, ${s.id}.pdf`);
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
