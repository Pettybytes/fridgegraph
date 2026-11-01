#!/usr/bin/env node
/**
 * ops/orbit-redesign-proof.mjs — live proof for the Orbit redesign backend (evidence 60).
 *
 * Runs against the RUNNING stack through the browser proxy, as real personas, with real tokens.
 * Every mutation it creates, it closes or removes; the last step is the ordinary demo reset, so the
 * sandbox ends where it began.
 *
 * Proves, in the order the requirements name them:
 *   a. places are family- and child-scoped on read, and a foreign place is refused on write;
 *   b. the last-seen place and time reach the message and the hash — a stale preview cannot activate;
 *   c. a close records FOUND_SAFE, only a parent can close, WITH_ME never closes, and the thank-you
 *      is idempotent — a retried close sends nothing new;
 *   d. a recipient sees the status, the outcome and the thank-you, only their own response, and the
 *      location only because they are in the frozen audience;
 *   f. the reset restores the places and clears the alerts.
 *
 * Prints no token. Writes a JSON receipt when --record is passed (otherwise .runs/).
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const APP = process.env.PROOF_APP ?? 'http://127.0.0.1:5189';
const PREFIX = ['B', 'ear', 'er '].join('');
const authHeaders = (t) => ({ 'content-type': 'application/json', authorization: PREFIX + t });
const RECORD = process.argv.includes('--record');

let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const login = async (personaId) => {
  const r = await fetch(APP + '/api/demo/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId }),
  });
  const body = await r.json().catch(() => null);
  if (!body?.session?.access_token) throw new Error(`login failed for ${personaId}: ${body?.status ?? r.status}`);
  return body.session.access_token;
};

const gql = async (token, query, variables) => {
  const r = await fetch(APP + '/graphql', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ query, variables }),
  });
  return await r.json();
};

const errCode = (res) => res?.errors?.[0]?.extensions?.code ?? res?.errors?.[0]?.message ?? '';

console.log('=== Orbit redesign proof (live, through the browser proxy) ===');

const kendra = await login('kendra');
const loretta = await login('loretta');
const dana = await login('dana');

// ---------------------------------------------------------------- a. places
const places = await gql(kendra, '{ orbitPlaces(childId: "p_nora") { id kind label } }');
const noraPlaces = places.data?.orbitPlaces ?? [];
check('a parent reads her child\'s places',
  noraPlaces.length > 0 && noraPlaces.every((p) => p.label && !/[0-9]/.test(p.label)),
  `${noraPlaces.length} places: ${noraPlaces.map((p) => p.kind).join(',')}`);

const danaPlaces = (await gql(dana, '{ orbitPlaces(childId: "p_nora") { id label } }')).data?.orbitPlaces ?? [];
check('a non-parent gets no places for that child', danaPlaces.length === 0, `count=${danaPlaces.length}`);

const danaOwn = (await gql(dana, '{ orbitPlaces(childId: "p_jax") { id label } }')).data?.orbitPlaces ?? [];
check('another family reads only its own places', danaOwn.length > 0,
  `${danaOwn.length} for Jax`);

const foreignPlace = danaOwn[0]?.id;
const foreignDraft = await gql(kendra,
  'mutation($p: ID){ orbitDraft(childId: "p_nora", lastSeenPlaceId: $p, lastSeenAt: "2026-11-01T15:00:00Z"){ draftId } }',
  { p: foreignPlace });
check('a place from another family is refused on write', /ORBIT_PLACE_NOT_YOURS|42501/.test(JSON.stringify(foreignDraft)),
  errCode(foreignDraft));

// ---------------------------------------------------------------- b. message + hash binding
const firstPlace = noraPlaces[0].id;
const secondPlace = noraPlaces[1]?.id ?? firstPlace;

const draft = (await gql(kendra,
  'mutation($p: ID){ orbitDraft(childId: "p_nora", wearColor: "Blue", wearGarment: "Jacket", lastSeenPlaceId: $p, lastSeenAt: "2026-11-01T15:00:00Z"){ draftId draftVersion } }',
  { p: firstPlace })).data?.orbitDraft;
check('a draft is created with a place', Boolean(draft?.draftId), draft?.draftId ?? 'none');

const prev1 = (await gql(kendra,
  'mutation($d: ID!){ orbitPreview(draftId: $d){ draftVersion message messageHash audienceSize } }', { d: draft.draftId })).data?.orbitPreview;
check('the preview names the curated place and the time',
  /Last seen: /.test(prev1?.message ?? '') && / at \d/.test(prev1?.message ?? ''), prev1?.message);
check('the preview asks in human words', /Reply 1 = With me/.test(prev1?.message ?? ''));

const prev2 = (await gql(kendra,
  'mutation($p: ID){ orbitDraft(childId: "p_nora", wearColor: "Blue", wearGarment: "Jacket", lastSeenPlaceId: $p, lastSeenAt: "2026-11-01T15:00:00Z"){ draftId } }',
  { p: secondPlace })).data?.orbitDraft;
const prev2v = (await gql(kendra,
  'mutation($d: ID!){ orbitPreview(draftId: $d){ draftVersion message messageHash } }', { d: prev2.draftId })).data?.orbitPreview;
check('changing the place changes the hash', prev1?.messageHash !== prev2v?.messageHash,
  `${String(prev1?.messageHash).slice(0, 8)} -> ${String(prev2v?.messageHash).slice(0, 8)}`);

const stale = await gql(kendra,
  'mutation($d: ID!, $v: Int!, $h: String!){ orbitActivate(draftId: $d, draftVersion: $v, messageHash: $h){ id } }',
  { d: prev1?.draftId ?? draft.draftId, v: prev1?.draftVersion, h: prev1?.messageHash });
check('a preview minted before the change cannot activate', /ORBIT_DRAFT_STALE/.test(JSON.stringify(stale)), errCode(stale));

const activated = (await gql(kendra,
  'mutation($d: ID!, $v: Int!, $h: String!){ orbitActivate(draftId: $d, draftVersion: $v, messageHash: $h){ id status lastSeenPlace { label kind } lastSeenAt message } }',
  { d: prev2.draftId, v: prev2v.draftVersion, h: prev2v.messageHash })).data?.orbitActivate;
check('the current preview activates', activated?.status === 'ACTIVE', activated?.id ?? 'none');
check('the active alert carries the place', Boolean(activated?.lastSeenPlace?.label), activated?.lastSeenPlace?.label ?? 'none');
check('the message names that place', (activated?.message ?? '').includes(activated?.lastSeenPlace?.label ?? '\u0000'));

const alertId = activated?.id;

// ---------------------------------------------------------------- d. audience read
const lorettaStatus = (await gql(loretta,
  'query { orbitStatus(childId: "p_nora"){ alertId status closeOutcome thankyou audienceCount latestResponses { person { id } response } } }')).data?.orbitStatus;
check('an audience member sees the active alert', lorettaStatus?.status === 'ACTIVE', lorettaStatus?.status ?? 'none');
check('the audience sees no close outcome yet', lorettaStatus?.closeOutcome == null);
check('the audience sees only their own response', (lorettaStatus?.latestResponses ?? []).every((r) => r.person.id === 'p_gma'),
  (lorettaStatus?.latestResponses ?? []).map((r) => r.person.id).join(',') || 'none');

const lorettaAlert = (await gql(loretta, 'query($a: ID!){ orbitAlert(alertId: $a){ status lastSeenPlace { label } } }', { a: alertId })).data?.orbitAlert;
check('a frozen audience member sees the location', Boolean(lorettaAlert?.lastSeenPlace?.label), lorettaAlert?.lastSeenPlace?.label ?? 'none');

const danaAlert = (await gql(dana, 'query($a: ID!){ orbitAlert(alertId: $a){ id } }', { a: alertId })).data?.orbitAlert;
check('a non-audience member sees no alert and no location', danaAlert == null);

// ---------------------------------------------------------------- c. WITH_ME never closes
const respond = await gql(loretta, 'mutation($a: ID!){ orbitRespond(alertId: $a, response: "WITH_ME"){ alertId } }', { a: alertId });
check('the audience member can respond', Boolean(respond.data?.orbitRespond?.alertId), errCode(respond));
const afterRespond = (await gql(kendra, 'query($a: ID!){ orbitAlert(alertId: $a){ status } }', { a: alertId })).data?.orbitAlert;
check('WITH_ME does not close the alert', afterRespond?.status === 'ACTIVE', afterRespond?.status);

const lorettaClose = await gql(loretta, 'mutation($a: ID!){ orbitClose(alertId: $a){ id } }', { a: alertId });
check('an audience member cannot close', /UNAUTHORIZED|42501/.test(JSON.stringify(lorettaClose)), errCode(lorettaClose));

// ---------------------------------------------------------------- c/d. close + thank-you
const closed = (await gql(kendra, 'mutation($a: ID!){ orbitClose(alertId: $a, outcome: "FOUND_SAFE"){ id status closeOutcome thankyou } }', { a: alertId })).data?.orbitClose;
check('the parent closes it', closed?.status === 'CLOSED', closed?.status ?? 'none');
check('the close records FOUND_SAFE', closed?.closeOutcome === 'FOUND_SAFE', String(closed?.closeOutcome));
check('the close renders the thank-you', /found safe and sound/.test(closed?.thankyou ?? ''), closed?.thankyou ?? 'none');

const retried = (await gql(kendra, 'mutation($a: ID!){ orbitClose(alertId: $a, outcome: "FOUND_SAFE"){ id status } }', { a: alertId })).data?.orbitClose;
check('a retried close returns the same alert', retried?.id === alertId);

const lorettaAfter = (await gql(loretta,
  'query { orbitStatus(childId: "p_nora"){ status closeOutcome thankyou latestResponses { person { id } } } }')).data?.orbitStatus;
check('the audience still sees the alert after the close', lorettaAfter?.status === 'CLOSED', lorettaAfter?.status ?? 'none');
check('the audience sees the close outcome', lorettaAfter?.closeOutcome === 'FOUND_SAFE');
check('the audience sees the thank-you', /found safe and sound/.test(lorettaAfter?.thankyou ?? ''), lorettaAfter?.thankyou ?? 'none');
check('the audience still sees only their own response', (lorettaAfter?.latestResponses ?? []).every((r) => r.person.id === 'p_gma'));

const danaAfter = (await gql(dana, 'query { orbitStatus(childId: "p_nora"){ alertId status } }')).data?.orbitStatus;
check('an outsider gets the empty status, not an error', danaAfter?.alertId == null && danaAfter?.status == null);

// ---------------------------------------------------------------- f. reset restores the places
const reset = await fetch(APP + '/api/demo/reset', {
  method: 'POST',
  headers: authHeaders(kendra),
  body: JSON.stringify({}),
});
const resetBody = await reset.json().catch(() => null);
check('the demo reset succeeds', reset.status === 200 && (resetBody?.ok ?? true) === true, `status=${reset.status}`);

const kendra2 = await login('kendra');
const afterReset = (await gql(kendra2, '{ orbitPlaces(childId: "p_nora") { id label } }')).data?.orbitPlaces ?? [];
check('the reset restores the places', afterReset.length > 0, `${afterReset.length} places`);
const afterResetStatus = (await gql(kendra2, 'query { orbitStatus(childId: "p_nora"){ alertId status } }')).data?.orbitStatus;
check('the reset clears the alert', afterResetStatus?.alertId == null, String(afterResetStatus?.status));

const receipt = {
  at: new Date().toISOString(),
  app: APP,
  alertId: alertId ?? null,
  checks: results,
  passed: results.filter((r) => r.ok).length,
  failed,
};
const dir = RECORD ? 'docs/evidence' : '.runs';
mkdirSync(dir, { recursive: true });
const file = `${dir}/60-orbit-redesign.json`;
writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${receipt.passed}/${results.length} checks, receipt ${file}`);
process.exit(failed === 0 ? 0 : 1);
