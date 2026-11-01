/**
 * ONE live evidence call for PR F: send a FICTIONAL, authored illustration (never a real
 * person/child, never a real photo) to the Meta vision model via the production VisionClient,
 * map the result against a sample vocabulary, and record the model id, the live result, and
 * what was dropped. The raw image is never logged. Output goes to .runs/ (gitignored) unless
 * --record is passed, which writes under evidence/ for the PR.
 *
 *   node --import tsx scripts/photo-vision-evidence.ts [--record]
 *
 * Requires META_API_KEY / META_BASE_URL / META_MODEL_ID. With no key configured it records a
 * BLOCKED result (the key has been the standing blocker) rather than fabricating a live one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
// playwright-core is CJS; import the default and destructure.
import playwright from '../web/node_modules/playwright-core/index.js';
const { chromium } = playwright as unknown as typeof import('playwright-core');
import { createMuseVisionClient, MUSE_VISION_MODEL } from '../src/rosina/museVision';
import { proposePhotoDescriptors } from '../src/rosina/photoDescriptors';
import { resolveProvider } from '../src/muse/providers';

// A fictional, obviously-illustrated child outfit — not a photograph, not a real person.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#eef3fb"/>
  <circle cx="256" cy="150" r="70" fill="#f3c9a0"/>
  <path d="M190 120q66-70 132 0q-10-44-66-44t-66 44z" fill="#4a3b2a"/>
  <circle cx="200" cy="120" r="16" fill="#4a3b2a"/><circle cx="312" cy="120" r="16" fill="#4a3b2a"/>
  <path d="M150 300q106-70 212 0l-20 150H170z" fill="#f4d03f"/>
  <rect x="150" y="300" width="212" height="40" rx="18" fill="#f4d03f"/>
  <rect x="330" y="250" width="110" height="150" rx="24" fill="#3aa65b"/>
  <rect x="352" y="238" width="66" height="26" rx="10" fill="#2f8c4c"/>
</svg>`;

async function rasterize(): Promise<Uint8Array> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(`<body style="margin:0">${SVG}</body>`);
  const buf = await page.screenshot({ type: 'png' });
  await browser.close();
  return new Uint8Array(buf);
}

const vocabularyByKind = new Map<string, ReadonlySet<string>>([
  ['WEAR_COLOR', new Set(['yellow', 'red', 'navy'])],
  ['WEAR_GARMENT', new Set(['raincoat', 'hoodie'])],
  ['HAIR', new Set(['curly', 'short'])],
  ['CARRY_COLOR', new Set(['green', 'blue'])],
  ['CARRY_ITEM', new Set(['backpack', 'lunchbox'])],
]);

const record = process.argv.includes('--record');
const outDir = record ? 'evidence/rosina/photo-vision' : '.runs';
mkdirSync(outDir, { recursive: true });
const outPath = `${outDir}/photo-vision-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

const base = {
  at: new Date().toISOString(),
  model: MUSE_VISION_MODEL,
  image: 'fictional authored SVG outfit (yellow raincoat, green backpack, curly hair) — not a real person or photo',
  note: 'raw image bytes are never logged; only the mapped result is recorded',
};

try {
  const cfg = resolveProvider('meta'); // throws if the key/base/model are not configured
  const vision = createMuseVisionClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: MUSE_VISION_MODEL });
  const image = { data: await rasterize(), contentType: 'image/png' };
  const proposal = await proposePhotoDescriptors({ image, childId: 'fictional_demo', vocabularyByKind, vision });
  writeFileSync(outPath, JSON.stringify({ ...base, status: 'LIVE', source: proposal.source, modelId: proposal.modelId, descriptors: proposal.descriptors, dropped: proposal.dropped, textInImage: proposal.textInImage }, null, 2));
  console.log(`[photo-vision] LIVE model=${proposal.modelId} source=${proposal.source} kept=${Object.keys(proposal.descriptors).length} dropped=${proposal.dropped.length} -> ${outPath}`);
} catch (err) {
  const reason = err instanceof Error ? err.message : 'unknown';
  writeFileSync(outPath, JSON.stringify({ ...base, status: 'BLOCKED', reason }, null, 2));
  console.log(`[photo-vision] BLOCKED (${reason}) -> ${outPath}`);
}
