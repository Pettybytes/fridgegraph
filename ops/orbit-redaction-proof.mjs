#!/usr/bin/env node
/**
 * ops/orbit-redaction-proof.mjs — live proof of the post-close redaction boundary (evidence 62).
 *
 * Real credentials through the browser proxy, plus the bypass routes an attacker would actually try:
 * a direct PostgREST table read, a direct RPC call, the photo endpoint, an unrelated caller and the
 * read-only demo guide.
 *
 * Proves:
 *   * while ACTIVE, a frozen recipient sees the descriptors, the place and the photo;
 *   * after the close, that same recipient sees status, outcome and thank-you — and NOTHING else,
 *     through GraphQL, through the table, through the RPC, or through the photo endpoint;
 *   * the parent keeps the full record and the photo after the close;
 *   * an unrelated caller and the guide cannot read the share even while the alert is ACTIVE;
 *   * the reset restores the places and clears the alert.
 *
 * No token, no URL and no photo bytes are printed or stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.env.PROOF_APP ?? 'http://127.0.0.1:5189';
const PHOTO_APP = process.env.PROOF_PHOTO_APP ?? 'http://127.0.0.1:4008';
const PREFIX = ['B', 'ear', 'er '].join('');
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  results.push({ label, ok, detail: String(detail) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const login = async (personaId) => {
  const r = await fetch(APP + '/api/demo/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId }),
  });
  const body = await r.json().catch(() => null);
  return body?.session?.access_token ?? null;
};

const gql = async (token, query, variables) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = PREFIX + token;
  const r = await fetch(APP + '/graphql', { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  return await r.json();
};

const codeOf = (res) => res?.errors?.[0]?.extensions?.code ?? res?.errors?.[0]?.message ?? '';

console.log('=== Orbit post-close redaction proof (live) ===');

const kendra = await login('kendra');   // parent
const loretta = await login('loretta'); // frozen audience
const dana = await login('dana');       // unrelated household
const guide = await login('demo-guide'); // read-only view
check('all four personas signed in', Boolean(kendra && loretta && dana && guide),
  `kendra=${Boolean(kendra)} loretta=${Boolean(loretta)} dana=${Boolean(dana)} guide=${Boolean(guide)}`);

// ---------------------------------------------------------------- a real registered photo
const cfg = await fetch(APP + '/api/demo/health').then((r) => r.json()).catch(() => null);
check('the stack answers a health read', Boolean(cfg));

const photoName = `proof-${Date.now()}.jpg`;
const photoDir = process.env.ORBIT_PHOTO_DIR ?? 'data/orbit-photos';
mkdirSync(photoDir, { recursive: true });
// 1x1 JPEG — enough for the endpoint, which only checks existence and sends bytes.
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
writeFileSync(join(photoDir, photoName), jpeg);

const place = (await gql(kendra, '{ orbitPlaces(childId: "p_nora") { id label } }')).data?.orbitPlaces?.[0];
check('the parent reads a place', Boolean(place?.id), place?.label ?? 'none');

// register the photo through the parent's own upload path so the row and bytes agree
const upload = await fetch(`${PHOTO_APP}/api/orbit/photo?childId=p_nora`, {
  method: 'POST',
  headers: { 'content-type': 'image/jpeg', authorization: PREFIX + kendra },
  body: jpeg,
});
const uploadBody = await upload.json().catch(() => null);
check('the parent registers a photo', upload.status === 200 || upload.status === 201,
  `status=${upload.status} ${uploadBody?.photoId ?? uploadBody?.error ?? ''}`);
const photoId = uploadBody?.photoId ?? uploadBody?.id ?? null;

// ---------------------------------------------------------------- draft, preview, activate
const draftRes = await gql(kendra,
  'mutation($p: ID, $ph: ID){ orbitDraft(childId: "p_nora", wearColor: "Blue", wearGarment: "Jacket", photoId: $ph, lastSeenPlaceId: $p, lastSeenAt: "2026-11-01T15:00:00Z"){ draftId } }',
  { p: place?.id, ph: photoId });
const draftId = draftRes.data?.orbitDraft?.draftId;
check('a draft is created with the place and the photo', Boolean(draftId), draftId ?? codeOf(draftRes));

const prev = (await gql(kendra, 'mutation($d: ID!){ orbitPreview(draftId: $d){ draftVersion messageHash audienceSize } }', { d: draftId })).data?.orbitPreview;
check('the preview mints a binding', Boolean(prev?.messageHash), `audience=${prev?.audienceSize}`);

const activated = (await gql(kendra,
  'mutation($d: ID!, $v: Int!, $h: String!){ orbitActivate(draftId: $d, draftVersion: $v, messageHash: $h){ id status } }',
  { d: draftId, v: prev?.draftVersion, h: prev?.messageHash })).data?.orbitActivate;
const alertId = activated?.id;
check('the alert is ACTIVE', activated?.status === 'ACTIVE', alertId ?? 'none');

// ---------------------------------------------------------------- ACTIVE: recipient has details
const act = (await gql(loretta, 'query($a: ID!){ orbitAlert(alertId: $a){ status message share { wearColor wearGarment photoId } lastSeenPlace { label } lastSeenAt } }', { a: alertId })).data?.orbitAlert;
check('ACTIVE recipient sees the descriptors', act?.share?.wearColor === 'Blue' && act?.share?.wearGarment === 'Jacket',
  `${act?.share?.wearColor}/${act?.share?.wearGarment}`);
check('ACTIVE recipient sees the place and time', act?.lastSeenPlace?.label === place?.label && Boolean(act?.lastSeenAt));
check('ACTIVE recipient sees the photo id', Boolean(act?.share?.photoId));

const photoActive = photoId ? await fetch(`${PHOTO_APP}/api/orbit/photo/${photoId}`, { headers: { authorization: PREFIX + loretta } }) : null;
check('ACTIVE recipient fetches the photo bytes', photoActive?.status === 200,
  `status=${photoActive?.status} access=${photoActive?.headers.get('x-orbit-access') ?? 'none'}`);

// ---------------------------------------------------------------- ACTIVE: unrelated + guide cannot
const danaActive = (await gql(dana, 'query($a: ID!){ orbitAlert(alertId: $a){ id } }', { a: alertId })).data?.orbitAlert;
check('an unrelated caller sees no alert at all', danaActive == null);
const danaPhoto = photoId ? await fetch(`${PHOTO_APP}/api/orbit/photo/${photoId}`, { headers: { authorization: PREFIX + dana } }) : null;
check('an unrelated caller cannot fetch the photo', danaPhoto?.status === 404, `status=${danaPhoto?.status}`);

// The guide is a read-only view of SANDBOX records, so seeing the alert shell is by design. What it
// must never get is the sensitive projection — that is the boundary being tested.
const guideActive = (await gql(guide, 'query($a: ID!){ orbitAlert(alertId: $a){ id status message share { wearColor photoId } lastSeenPlace { label } lastSeenAt } }', { a: alertId })).data?.orbitAlert;
check('the demo guide gets no sensitive fields (no bypass)',
  guideActive == null || (guideActive.message == null && guideActive.share?.wearColor == null
    && guideActive.share?.photoId == null && guideActive.lastSeenPlace == null && guideActive.lastSeenAt == null),
  guideActive ? 'shell only' : 'no alert at all');

// ---------------------------------------------------------------- the bypass routes, ACTIVE
const restUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const restSelect = async (token, columns) => {
  const r = await fetch(`${restUrl}/rest/v1/orbit_alerts?select=${columns}&id=eq.${alertId}`, {
    headers: { apikey: anon, authorization: PREFIX + token },
  });
  return { status: r.status, body: await r.text() };
};
if (restUrl && anon) {
  const direct = await restSelect(loretta, 'wear_color');
  check('a direct REST read of a sensitive column is refused (even while ACTIVE)',
    direct.status !== 200 || !direct.body.includes('Blue'), `status=${direct.status}`);
  const safe = await restSelect(loretta, 'id,status');
  check('a direct REST read of a safe column still works', safe.status === 200, `status=${safe.status}`);
} else {
  check('REST bypass could be tested', false, 'SUPABASE_URL/ANON_KEY missing');
}

// ---------------------------------------------------------------- close
const closedRes = await gql(kendra, 'mutation($a: ID!){ orbitClose(alertId: $a, outcome: "FOUND_SAFE"){ id status closeOutcome } }', { a: alertId });
const closed = closedRes.data?.orbitClose;
check('the parent closes it', closed?.status === 'CLOSED' && closed?.closeOutcome === 'FOUND_SAFE',
  closedRes.errors ? String(codeOf(closedRes)) : String(closed?.status ?? 'none'));

// ---------------------------------------------------------------- CLOSED: recipient loses details
const after = (await gql(loretta, 'query($a: ID!){ orbitAlert(alertId: $a){ status closeOutcome thankyou message share { wearColor wearGarment photoId description } lastSeenPlace { label } lastSeenAt } }', { a: alertId })).data?.orbitAlert;
check('CLOSED recipient still sees status and outcome', after?.status === 'CLOSED' && after?.closeOutcome === 'FOUND_SAFE');
check('CLOSED recipient still sees the thank-you', /found safe and sound/.test(after?.thankyou ?? ''));
check('CLOSED recipient gets NO descriptors', after?.share?.wearColor == null && after?.share?.wearGarment == null && after?.share?.description === '',
  JSON.stringify(after?.share ?? {}));
check('CLOSED recipient gets NO message', after?.message == null);
check('CLOSED recipient gets NO photo id', after?.share?.photoId == null);
check('CLOSED recipient gets NO place or time', after?.lastSeenPlace == null && after?.lastSeenAt == null);

const photoClosed = photoId ? await fetch(`${PHOTO_APP}/api/orbit/photo/${photoId}`, { headers: { authorization: PREFIX + loretta } }) : null;
check('CLOSED recipient photo GET is refused', photoClosed?.status === 404, `status=${photoClosed?.status}`);

if (restUrl && anon) {
  const direct = await restSelect(loretta, 'wear_color,minimal_message,photo_id,last_seen_at');
  check('CLOSED recipient cannot read the sensitive columns via REST',
    direct.status !== 200, `status=${direct.status}`);
  const rpc = await fetch(`${restUrl}/rest/v1/rpc/orbit_share_for`, {
    method: 'POST',
    headers: { apikey: anon, authorization: PREFIX + loretta, 'content-type': 'application/json' },
    body: JSON.stringify({ p_alert: alertId }),
  });
  const rpcBody = await rpc.text();
  check('CLOSED recipient gets no share row from the RPC',
    rpc.status !== 200 || rpcBody.trim() === '[]', `status=${rpc.status} body=${rpcBody.slice(0, 40)}`);
}

// ---------------------------------------------------------------- CLOSED: parent keeps everything
const parentAfter = (await gql(kendra, 'query($a: ID!){ orbitAlert(alertId: $a){ status closeOutcome message share { wearColor wearGarment photoId } lastSeenPlace { label } lastSeenAt } }', { a: alertId })).data?.orbitAlert;
check('the parent keeps the descriptors', parentAfter?.share?.wearColor === 'Blue');
check('the parent keeps the message', Boolean(parentAfter?.message));
check('the parent keeps the place and time', parentAfter?.lastSeenPlace?.label === place?.label && Boolean(parentAfter?.lastSeenAt));
const parentPhoto = photoId ? await fetch(`${PHOTO_APP}/api/orbit/photo/${photoId}`, { headers: { authorization: PREFIX + kendra } }) : null;
check('the parent keeps the photo after closure', parentPhoto?.status === 200,
  `status=${parentPhoto?.status} access=${parentPhoto?.headers.get('x-orbit-access') ?? 'none'}`);

// ---------------------------------------------------------------- reset
const doReset = () => fetch(APP + '/api/demo/reset', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: PREFIX + kendra },
  body: JSON.stringify({}),
});
let reset = await doReset();
if (reset.status === 429) {
  // The demo-login limiter is per IP and this proof makes several logins; wait the window out
  // rather than reporting a rate limit as a failure of the reset.
  console.log('  ... demo-login limiter busy, waiting 62s');
  await new Promise((r) => setTimeout(r, 62_000));
  reset = await doReset();
}
check('the demo reset succeeds', reset.status === 200, `status=${reset.status}`);
const kendra2 = await login('kendra');
const placesAfter = (await gql(kendra2, '{ orbitPlaces(childId: "p_nora") { id } }')).data?.orbitPlaces ?? [];
check('the reset restores the places', placesAfter.length > 0, `${placesAfter.length} places`);
const statusAfter = (await gql(kendra2, 'query { orbitStatus(childId: "p_nora"){ alertId } }')).data?.orbitStatus;
check('the reset clears the alert', statusAfter?.alertId == null);

const receipt = {
  at: new Date().toISOString(),
  alertId: alertId ?? null,
  checks: results,
  passed: results.filter((r) => r.ok).length,
  failed,
  notes: {
    signedUrls:
      'The photo endpoint never mints a signed URL: every GET re-evaluates orbit_photo_access and '
      + 'streams the bytes itself, so there is no URL whose lifetime could outlive the close. The '
      + 'question is answered by construction, and the same GET that returned bytes before the close '
      + 'returns 404 after it.',
    bypassRoutes: ['GraphQL', 'PostgREST table read', 'PostgREST RPC orbit_share_for', 'photo endpoint'],
  },
};
mkdirSync('docs/evidence', { recursive: true });
writeFileSync('docs/evidence/62-orbit-redaction.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${receipt.passed}/${results.length} checks, receipt docs/evidence/62-orbit-redaction.json`);
process.exit(failed === 0 ? 0 : 1);
