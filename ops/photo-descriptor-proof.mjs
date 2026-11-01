#!/usr/bin/env node
/**
 * ops/photo-descriptor-proof.mjs — evidence 63: the photo-descriptors endpoint's real authority.
 *
 * Two layers, kept deliberately separate:
 *
 *  A. OFFLINE / DETERMINISTIC. The REAL production wiring (`buildPhotoDeps`) plus the REAL handler,
 *     against a fake RLS client that answers `orbit_photo_access` the way the database does, and a
 *     COUNTING vision stub. This is the independent proof that a refused request never reaches
 *     vision. The counter is falsifiable: the success case must increment it, so "0 on rejection"
 *     cannot be produced by a counter that never fires.
 *
 *  B. LIVE. The DEPLOYED authenticated endpoint through the browser proxy, as real personas with
 *     real tokens issued by the picker: parent 200, unauthorized 403, ACTIVE-alert AUDIENCE 403
 *     (the SAME body), and the existing recipient photo GET still returning the image.
 *
 * The live layer's "no `model=` suffix in the 403 log line" is SUPPORTING evidence only; it is not
 * independent proof that no upstream call happened. Layer A is that proof.
 *
 * Prints no token. Writes a JSON receipt when --record is passed (otherwise .runs/).
 * Run with: node --import tsx ops/photo-descriptor-proof.mjs [--record] [--offline-only|--live-only]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPhotoDeps } from '../src/rosina/photoDeps.ts';
import { createPhotoDescriptorsHandler } from '../src/rosina/photoEndpoint.ts';
import { VISION_MODEL_ID } from '../src/rosina/photoDescriptors.ts';
import { DESCRIPTOR_VOCAB_KIND } from '../src/rosina/orbit.ts';

const APP = process.env.PROOF_APP ?? 'http://127.0.0.1:5189';
const RECORD = process.argv.includes('--record');
const OFFLINE_ONLY = process.argv.includes('--offline-only');
const LIVE_ONLY = process.argv.includes('--live-only');
const DO_RESET = !process.argv.includes('--no-reset');

const results = [];
let failed = 0;
const check = (layer, label, ok, detail = '') => {
  if (!ok) failed += 1;
  results.push({ layer, label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${layer}] ${label}${detail ? ' — ' + detail : ''}`);
};

/* ------------------------------------------------------------------ layer A: offline */

async function offlinePhase() {
  console.log('\n--- A. offline: real wiring + counting vision stub ---');

  const photoDir = mkdtempSync(join(tmpdir(), 'orbit-photos-proof-'));
  writeFileSync(join(photoDir, 'orbit-nora.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const PHOTOS = { ph_nora: { child: 'p_nora', path: 'orbit-nora.jpg' } };
  const fakeDbFor = (ctx) => ({
    async rpc(fn, args) {
      if (fn !== 'orbit_photo_access') return { data: null, error: { message: 'unknown rpc' } };
      const p = PHOTOS[String((args ?? {}).p_photo)];
      if (ctx.token === 'kendra' && p) {
        return { data: [{ access: 'PARENT', storage_path: p.path, child_id: p.child }], error: null };
      }
      // A frozen recipient of an ACTIVE alert: the database itself grants AUDIENCE.
      if (ctx.token === 'audience' && p) {
        return { data: [{ access: 'AUDIENCE', storage_path: p.path, child_id: p.child }], error: null };
      }
      return { data: [], error: null }; // unauthorized == nonexistent: the same empty answer
    },
    from() {
      return {
        async select() {
          return {
            data: [{ kind: 'WEAR_COLOR', value: 'yellow' }, { kind: 'CARRY_ITEM', value: 'backpack' }],
            error: null,
          };
        },
      };
    },
  });

  const makeVision = (calls) => ({
    async describe() {
      calls.n += 1;
      return {
        modelId: VISION_MODEL_ID,
        source: 'live',
        // 'skateboard' is deliberately off-vocabulary: it must be DROPPED, never forced.
        descriptors: [{ key: 'wearColor', value: 'yellow' }, { key: 'carryItem', value: 'skateboard' }],
      };
    },
  });

  const TOKENS = { kendra: 'p_mom', priya: 'p_priya', audience: 'p_ray' };
  const handlerWith = (vision) =>
    createPhotoDescriptorsHandler(
      buildPhotoDeps({
        verify: async (h) => {
          const token = String(h ?? '').replace(/^Bearer\s+/i, '').trim();
          const personId = TOKENS[token];
          return personId ? { ok: true, personId } : { ok: false };
        },
        rateLimiter: { allow: () => true },
        vision,
        photoDir,
        dbForFn: fakeDbFor,
      }),
    );

  const call = async (handler, bearer, body) => {
    let code = 0;
    let payload;
    const req = {
      header: (n) => (String(n).toLowerCase() === 'authorization' ? `Bearer ${bearer}` : undefined),
      body,
    };
    const res = {
      status(c) { code = c; return res; },
      json(o) { payload = o; return res; },
    };
    await handler(req, res);
    return { code, payload };
  };

  const calls = { n: 0 };
  const handler = handlerWith(makeVision(calls));

  // 1 (offline control): an authorized parent DOES reach vision — this is what makes a zero
  //   counter meaningful later.
  calls.n = 0;
  const ok = await call(handler, 'kendra', { childId: 'p_nora', photoId: 'ph_nora' });
  const descriptors = ok.payload?.descriptors ?? {};
  check('offline', 'authorized parent → 200 with an in-vocabulary proposal',
    ok.code === 200 && descriptors.wearColor === 'yellow',
    `status=${ok.code} descriptors=${JSON.stringify(descriptors)}`);
  check('offline', 'off-vocabulary value is DROPPED, never forced onto the nearest value',
    !Object.values(descriptors).includes('skateboard') && (ok.payload?.dropped ?? []).length >= 1,
    `dropped=${JSON.stringify(ok.payload?.dropped ?? [])}`);
  check('offline', 'positive control: the success path increments the vision counter exactly once',
    calls.n === 1, `visionCalls=${calls.n}`);

  // 2: unauthorized caller — zero vision invocations.
  calls.n = 0;
  const priya = await call(handler, 'priya', { childId: 'p_nora', photoId: 'ph_nora' });
  check('offline', 'unauthorized caller → 403 generic, and vision is never invoked',
    priya.code === 403 && priya.payload?.error === 'NOT_AUTHORIZED' && calls.n === 0,
    `status=${priya.code} error=${priya.payload?.error} visionCalls=${calls.n}`);

  // 3: AUDIENCE recipient — same generic 403, zero vision invocations.
  calls.n = 0;
  const audience = await call(handler, 'audience', { childId: 'p_nora', photoId: 'ph_nora' });
  check('offline', 'ACTIVE-alert AUDIENCE recipient → the SAME generic 403, vision never invoked',
    audience.code === 403 && audience.payload?.error === 'NOT_AUTHORIZED' && calls.n === 0,
    `status=${audience.code} visionCalls=${calls.n}`);
  check('offline', 'the two refusals are byte-identical (no existence oracle)',
    JSON.stringify(priya.payload) === JSON.stringify(audience.payload),
    JSON.stringify(audience.payload));

  // 3b: wrong-child / missing photo — same refusal, no vision.
  calls.n = 0;
  const missing = await call(handler, 'kendra', { childId: 'p_nora', photoId: 'ph_missing' });
  check('offline', 'authorized parent, unknown photo → the SAME generic 403, vision never invoked',
    missing.code === 403 && JSON.stringify(missing.payload) === JSON.stringify(audience.payload) && calls.n === 0,
    `status=${missing.code} visionCalls=${calls.n}`);

  // 4: the verified handler order. Authorization is checked BEFORE the vision-configured branch,
  //    so an unauthorized caller sees 403 (not 503) even when no provider is configured…
  calls.n = 0;
  const noVisionUnauthorized = await call(handlerWith(null), 'priya', { childId: 'p_nora', photoId: 'ph_nora' });
  check('offline', 'order: authorization precedes the vision-configured branch (403, not 503)',
    noVisionUnauthorized.code === 403, `status=${noVisionUnauthorized.code}`);
  // …and the 503 branch is real, so the check above is not vacuous.
  const noVisionAuthorized = await call(handlerWith(null), 'kendra', { childId: 'p_nora', photoId: 'ph_nora' });
  check('offline', 'order: an authorized parent with no provider configured → 503 (branch is live)',
    noVisionAuthorized.code === 503 && noVisionAuthorized.payload?.error === 'VISION_UNAVAILABLE',
    `status=${noVisionAuthorized.code}`);

  return { photoDir };
}

/* ------------------------------------------------------------------ layer B: live */

const PREFIX = ['B', 'ear', 'er '].join('');
const authHeaders = (t) => ({ authorization: PREFIX + t });

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
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ query, variables }),
  });
  return await r.json();
};
const errCode = (res) => res?.errors?.[0]?.extensions?.code ?? res?.errors?.[0]?.message ?? '';

const propose = async (token, childId, photoId) => {
  const r = await fetch(APP + '/api/rosina/photo-descriptors', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ childId, photoId }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// A 1x1 JPEG; the upload path re-encodes it with `sips` and strips segments, so it must be real.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwc' +
  'KDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAA' +
  'AAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

async function livePhase() {
  console.log('\n--- B. live: the deployed authenticated endpoint ---');

  const kendra = await login('kendra');
  const priya = await login('priya');
  const loretta = await login('loretta');

  // Upload as the parent: this is the ordinary Orbit path, and the proof cleans it up by reset.
  const up = await fetch(APP + '/api/orbit/photo?childId=p_nora', {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', ...authHeaders(kendra) },
    body: TINY_JPEG,
  });
  const upBody = await up.json().catch(() => null);
  const photoId = upBody?.photoId;
  check('live', 'parent uploads a photo through the ordinary Orbit path', up.status === 200 && !!photoId,
    `status=${up.status} bytes=${upBody?.bytes ?? '?'}`);

  // Controlled vocabulary, as the parent, for the in-vocabulary assertion.
  const vocabRes = await gql(kendra, '{ orbitVocabulary { kind value version } }');
  const vocab = new Set((vocabRes.data?.orbitVocabulary ?? []).map((e) => `${e.kind}:${e.value}`));
  check('live', 'controlled vocabulary readable by the parent', vocab.size > 0, `entries=${vocab.size}`);

  // 1. Kendra (parent) → 200, in-vocabulary, review-only.
  const before = await gql(kendra, '{ orbitStatus(childId: "p_nora") { alertId status } }');
  const beforeAlert = before.data?.orbitStatus?.alertId ?? null;

  const k = await propose(kendra, 'p_nora', photoId);
  const props = k.body?.descriptors ?? {};
  const kinds = Object.keys(props);
  const inVocab = kinds.every((key) => {
    const kind = DESCRIPTOR_VOCAB_KIND[key];
    return kind ? vocab.has(`${kind}:${props[key]}`) : false;
  });
  check('live', 'Kendra (parent) → 200 with a controlled-vocabulary proposal', k.status === 200,
    `status=${k.status} model=${k.body?.modelId ?? '?'} source=${k.body?.source ?? '?'} keys=${kinds.join(',') || 'none'}`);
  check('live', 'every proposed value is inside THIS child\'s vocabulary', kinds.length > 0 ? inVocab : true,
    kinds.length ? JSON.stringify(props) : 'no descriptors proposed (empty is valid; nothing invented)');
  check('live', 'the model and whether it was live/cached are stated', !!k.body?.modelId && !!k.body?.source,
    `${k.body?.modelId ?? '?'} / ${k.body?.source ?? '?'}`);
  check('live', 'the reply is the review-proposal envelope, not a draft or an alert',
    !!k.body && Array.isArray(k.body.dropped) && typeof k.body.descriptors === 'object' && k.body.descriptors !== null,
    `keys=${Object.keys(k.body ?? {}).join(',')}`);

  const afterProposal = await gql(kendra, '{ orbitStatus(childId: "p_nora") { alertId status } }');
  check('live', 'the proposal is review-only: it creates no alert and changes no Orbit state',
    (afterProposal.data?.orbitStatus?.alertId ?? null) === beforeAlert,
    `before=${beforeAlert ?? 'none'} after=${afterProposal.data?.orbitStatus?.alertId ?? 'none'}`);

  // 2. Priya (unauthorized) → generic 403.
  const p = await propose(priya, 'p_nora', photoId);
  check('live', 'Priya (unauthorized) → generic 403', p.status === 403 && p.body?.error === 'NOT_AUTHORIZED',
    `status=${p.status} body=${JSON.stringify(p.body)}`);

  // 3. A CONFIRMED ACTIVE-alert AUDIENCE recipient → the SAME generic 403.
  const draftRes = await gql(kendra,
    'mutation($p: ID){ orbitDraft(childId: "p_nora", photoId: $p, wearColor: "yellow"){ draftId draftVersion status } }',
    { p: photoId });
  const draft = draftRes.data?.orbitDraft;
  // orbitPreview is a MUTATION in the served schema, not a Query field.
  const prev = await gql(kendra, 'mutation($d: ID!){ orbitPreview(draftId: $d){ draftId draftVersion messageHash audienceSize } }',
    { d: draft?.draftId });
  const pre = prev.data?.orbitPreview;
  // `draftVersion: Int!` and `messageHash: String!` are non-null arguments: a nullable variable
  // cannot be passed to them (that fails validation before the resolver ever runs).
  const act = draft?.draftId && pre?.messageHash
    ? await gql(kendra,
      'mutation($d: ID!, $v: Int!, $h: String!){ orbitActivate(draftId: $d, draftVersion: $v, messageHash: $h){ id status } }',
      { d: draft.draftId, v: pre.draftVersion, h: pre.messageHash })
    : { errors: [{ extensions: { code: `NO_PREVIEW(${errCode(draftRes) || errCode(prev)})` } }] };
  const alert = act.data?.orbitActivate;
  check('live', 'a real alert is ACTIVE with a frozen audience (setup for case 3)', !!alert?.id,
    `alert=${alert?.id ?? errCode(act)} status=${alert?.status ?? '?'} audience=${pre?.audienceSize ?? '?'}`);

  const a = await propose(loretta, 'p_nora', photoId);
  check('live', 'confirmed ACTIVE-alert AUDIENCE recipient → the SAME generic 403',
    a.status === 403 && JSON.stringify(a.body) === JSON.stringify(p.body),
    `status=${a.status} body=${JSON.stringify(a.body)}`);

  // 5. Authorized recipient photo VIEWING during the ACTIVE alert still works, unchanged.
  const view = await fetch(`${APP}/api/orbit/photo/${photoId}`, { headers: authHeaders(loretta) });
  const bytes = Buffer.from(await view.arrayBuffer());
  check('live', 'recipient photo GET during the ACTIVE alert still returns the image',
    view.status === 200 && bytes.length > 0 && (view.headers.get('content-type') ?? '').startsWith('image/'),
    `status=${view.status} contentType=${view.headers.get('content-type')} access=${view.headers.get('x-orbit-access')} bytes=${bytes.length}`);
  check('live', 'the photo GET keeps its own 404 semantics (not the descriptor 403)',
    (await fetch(`${APP}/api/orbit/photo/ph_does_not_exist`, { headers: authHeaders(loretta) })).status === 404,
    'unknown photo → 404');

  // Clean up: close the alert we opened.
  if (alert?.id) {
    const close = await gql(kendra, 'mutation($a: ID!){ orbitClose(alertId: $a){ id status } }', { a: alert.id });
    check('live', 'the proof closes the alert it activated',
      String(close.data?.orbitClose?.status ?? '').toUpperCase() === 'CLOSED',
      `status=${close.data?.orbitClose?.status ?? errCode(close)}`);
  }

  return { photoId, alertId: alert?.id ?? null };
}

/* ------------------------------------------------------------------ run */

const receipt = { script: 'photo-descriptor-proof', startedAt: new Date().toISOString(), app: APP, results };

try {
  if (!LIVE_ONLY) receipt.offline = await offlinePhase();
  if (!OFFLINE_ONLY) receipt.live = await livePhase();

  if (!OFFLINE_ONLY && DO_RESET) {
    const kendra = await login('kendra');
    let r = await fetch(APP + '/api/demo/reset', { method: 'POST', headers: { ...authHeaders(kendra) } });
    let b = await r.json().catch(() => null);
    // One reset per person per 30 s: an earlier run in the same window can still be cooling down.
    if (r.status === 429) {
      console.log('  ..    reset rate-limited (one per person per 30 s); waiting 31 s');
      await new Promise((res) => setTimeout(res, 31_000));
      r = await fetch(APP + '/api/demo/reset', { method: 'POST', headers: { ...authHeaders(kendra) } });
      b = await r.json().catch(() => null);
    }
    check('live', 'ordinary demo reset restores the sandbox', r.status === 200 && b?.ok !== false,
      `status=${r.status}`);
    receipt.reset = { status: r.status, body: b };
  }
} catch (error) {
  check('run', 'the proof ran to completion', false, String(error?.message ?? error));
}

receipt.finishedAt = new Date().toISOString();
receipt.passed = results.filter((r) => r.ok).length;
receipt.failed = failed;
const dir = RECORD ? 'docs/evidence' : '.runs';
mkdirSync(dir, { recursive: true });
const file = `${dir}/63-photo-descriptor-authority.json`;
writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${receipt.passed}/${results.length} checks, receipt ${file}`);
process.exit(failed === 0 ? 0 : 1);
