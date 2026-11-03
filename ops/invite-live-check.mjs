#!/usr/bin/env node
/**
 * ONE bounded real-generation check for the live Muse Image path (INVITE_LIVE=1). PREPARED by
 * this PR; NOT executed by it — no provider call was made while writing this. For Bentley, in
 * his own authorized window, against a running Rosina service with INVITE_LIVE=1 and a real
 * Meta provider key configured.
 *
 * Does exactly ONE real thing: a single POST /api/rosina/invite as a real demo-session parent,
 * asserts the response actually came from the live model (provenance.source === 'MUSE_IMAGE',
 * provenance.model === 'muse-image-1.0', provenance.cached === false on this first call), and
 * prints the art's measured byte size and sha256 — never the image bytes themselves, never the
 * API key, never a provider URL.
 *
 * Usage (Bentley's window only):
 *   ROSINA_BASE_URL=http://127.0.0.1:4200 DEMO_BEARER=<a real Kendra session token> \
 *     node ops/invite-live-check.mjs
 *
 * Exits non-zero on ANY unexpected shape, a non-MUSE_IMAGE source, or an HTTP error — this check
 * is meant to fail loud, not silently pass a fixture response.
 */
import { createHash } from 'node:crypto';

const BASE = process.env.ROSINA_BASE_URL;
const BEARER = process.env.DEMO_BEARER;
const CHILD_ID = process.env.INVITE_LIVE_CHECK_CHILD_ID ?? 'p_nora';

if (!BASE || !BEARER) {
  console.error('[invite-live-check] BLOCKED: set ROSINA_BASE_URL and DEMO_BEARER. Not run.');
  process.exit(2);
}

const body = {
  childId: CHILD_ID,
  request: 'A birthday party invitation with balloons and a cake, for a single bounded live-generation check.',
};

console.log(`[invite-live-check] ONE real request to ${BASE}/api/rosina/invite for child ${CHILD_ID}`);
const res = await fetch(`${BASE}/api/rosina/invite`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${BEARER}` },
  body: JSON.stringify(body),
});

const json = await res.json();

if (!res.ok) {
  console.error(`[invite-live-check] FAILED: HTTP ${res.status} ${JSON.stringify(json)}`);
  process.exit(1);
}
if (json.status !== 'READY' || !json.art) {
  console.error(`[invite-live-check] FAILED: expected READY with art, got status=${json.status} clarification=${JSON.stringify(json.clarification)}`);
  process.exit(1);
}
if (json.provenance?.source !== 'MUSE_IMAGE') {
  console.error(`[invite-live-check] FAILED: expected provenance.source=MUSE_IMAGE, got ${json.provenance?.source} — INVITE_LIVE is likely not actually 1 on this process`);
  process.exit(1);
}
if (json.provenance?.model !== 'muse-image-1.0') {
  console.error(`[invite-live-check] FAILED: expected model=muse-image-1.0, got ${json.provenance?.model}`);
  process.exit(1);
}
if (json.provenance?.cached !== false) {
  console.error(`[invite-live-check] FAILED: expected cached=false on a fresh prompt, got ${json.provenance?.cached}`);
  process.exit(1);
}

const bytes = Buffer.from(json.art.base64, 'base64');
const sha256 = createHash('sha256').update(bytes).digest('hex');

console.log('[invite-live-check] PASS — one real live generation confirmed:');
console.log(`  provenance: source=${json.provenance.source} model=${json.provenance.model} cached=${json.provenance.cached}`);
console.log(`  art: ${json.art.mimeType} ${json.art.width}x${json.art.height}, ${bytes.length} bytes, sha256=${sha256}`);
console.log(`  promptHash: ${json.provenance.promptHash}`);
console.log('  (image bytes and the API key are never printed)');
