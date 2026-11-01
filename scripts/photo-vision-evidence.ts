/**
 * ONE live evidence call for PR F: send a FICTIONAL, authored illustration (never a real
 * person/child, never a real photo) to the Meta vision model via the production VisionClient,
 * map the result against a sample vocabulary, and record the model id, the live result, and
 * what was dropped. The raw image is never logged. Output goes to .runs/ (gitignored) unless
 * --record is passed, which writes under evidence/ for the PR.
 *
 *   node --import tsx scripts/photo-vision-evidence.ts [--record]
 *
 * Standalone: the only input is the committed fixture PNG (scripts/fixtures/fictional-outfit.png);
 * no browser/Playwright and no web deps, so the root typecheck resolves it and Bentley can run it
 * from the serving worktree. Requires META_API_KEY / META_BASE_URL / META_MODEL_ID. With no key
 * configured it records a BLOCKED result (the standing blocker) rather than fabricating a live one
 * — never copy an env or go looking for credentials.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMuseVisionClient, MUSE_VISION_MODEL } from '../src/rosina/museVision';
import { proposePhotoDescriptors } from '../src/rosina/photoDescriptors';
import { resolveProvider } from '../src/muse/providers';

const here = dirname(fileURLToPath(import.meta.url));

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
  image: 'fictional authored illustration (yellow raincoat, green backpack, curly hair) — not a real person or photo',
  note: 'raw image bytes are never logged; only the mapped result is recorded',
};

try {
  const cfg = resolveProvider('meta'); // throws if the key/base/model are not configured
  const vision = createMuseVisionClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: MUSE_VISION_MODEL });
  const image = { data: new Uint8Array(readFileSync(join(here, 'fixtures', 'fictional-outfit.png'))), contentType: 'image/png' };
  const proposal = await proposePhotoDescriptors({ image, childId: 'fictional_demo', vocabularyByKind, vision });
  writeFileSync(outPath, JSON.stringify({ ...base, status: 'LIVE', source: proposal.source, modelId: proposal.modelId, descriptors: proposal.descriptors, dropped: proposal.dropped, textInImage: proposal.textInImage }, null, 2));
  console.log(`[photo-vision] LIVE model=${proposal.modelId} source=${proposal.source} kept=${Object.keys(proposal.descriptors).length} dropped=${proposal.dropped.length} -> ${outPath}`);
} catch (err) {
  const reason = err instanceof Error ? err.message : 'unknown';
  writeFileSync(outPath, JSON.stringify({ ...base, status: 'BLOCKED', reason }, null, 2));
  console.log(`[photo-vision] BLOCKED (${reason}) -> ${outPath}`);
}
