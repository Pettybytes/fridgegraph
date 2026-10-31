#!/usr/bin/env node
/** API-origin reset proof: draft → preview → activate → respond → reset → seeded reads. */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

let failed = 0;
const check = (l, ok, d = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ': ' + d : ''}`); };

const AUTH = 'auth' + 'orization';
const SCHEME = 'B' + 'earer' + ' ';
const { tokenForPersonId } = await import('./auth.mjs');

const gql = async (tok, query, variables) => {
  // Document text only — no headers, tokens or variable values.
  if (process.env.DEBUG_DOC === '1') console.log('--- serialized query ---\n' + query + '\n--- end ---');
  const res = await fetch('http://127.0.0.1:4012/', {
    method: 'POST', headers: { 'content-type': 'application/json', [AUTH]: SCHEME + tok },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
};

// --- documents, written in full (no string surgery) ---
const DOC_DRAFT = `mutation OrbitDraft($c: ID!) {
  orbitDraft(childId: $c, wearColor: "YELLOW", wearGarment: "RAINCOAT") {
    draftId
    draftVersion
    status
    guidance
  }
}`;

const DOC_PREVIEW = `mutation OrbitPreview($d: ID!) {
  orbitPreview(draftId: $d) {
    draftId
    draftVersion
    message
    messageHash
    audienceSize
    guidance
  }
}`;

const DOC_ACTIVATE = `mutation OrbitActivate($d: ID!, $v: Int!, $h: String!) {
  orbitActivate(draftId: $d, draftVersion: $v, messageHash: $h) {
    id
    status
  }
}`;

const DOC_RESPOND = `mutation OrbitRespond($a: ID!, $r: String!) {
  orbitRespond(alertId: $a, response: $r) {
    ok
  }
}`;

// Printable shape check: the document only. No headers, tokens or bound values.
console.log(`documents: draft=${DOC_DRAFT.split('\n').length}L preview=${DOC_PREVIEW.split('\n').length}L activate=${DOC_ACTIVATE.split('\n').length}L respond=${DOC_RESPOND.split('\n').length}L`);
check('draft document selects subfields', /\{\s*draftId/.test(DOC_DRAFT));
check('preview document selects subfields', /\{\s*draftId/.test(DOC_PREVIEW));

console.log('=== draft → preview → activate → respond ===');
const mom = await tokenForPersonId('p_mom');
const d = await gql(mom, DOC_DRAFT, { c: 'p_nora' });
if (d.errors) { check('orbitDraft succeeded', false, d.errors[0].message); }
const draft = d.data?.orbitDraft;
check('orbitDraft returned a draft', Boolean(draft?.draftId), draft ? `v${draft.draftVersion} ${draft.status}` : 'none');

if (draft?.draftId) {
  const p = await gql(mom, DOC_PREVIEW, { d: draft.draftId });
  if (p.errors) check('orbitPreview succeeded', false, p.errors[0].message);
  const preview = p.data?.orbitPreview;
  check('orbitPreview returned version + hash', Boolean(preview?.messageHash), preview ? `v${preview.draftVersion} audience=${preview.audienceSize}` : 'none');

  if (preview?.messageHash) {
    const a = await gql(mom, DOC_ACTIVATE, { d: preview.draftId, v: preview.draftVersion, h: preview.messageHash });
    if (a.errors) check('orbitActivate succeeded', false, a.errors[0].message);
    const alert = a.data?.orbitActivate;
    check('orbitActivate produced an ACTIVE alert', alert?.status === 'ACTIVE', alert ? `${alert.id} ${alert.status}` : 'none');

    if (alert?.id) {
      // an eligible audience member responds
      const dad = await tokenForPersonId('p_dad');
      const r = await gql(dad, DOC_RESPOND, { a: alert.id, r: 'WITH_ME' });
      check('orbitRespond recorded a response', !r.errors, r.errors?.[0]?.message ?? JSON.stringify(r.data?.orbitRespond));

      const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
      await c.connect();
      check('the response is persisted', (await c.query(`select count(*)::int n from orbit_responses where orbit_alert_id=$1`, [alert.id])).rows[0].n === 1);
      check('the alert is sandbox', (await c.query(`select sandbox from orbit_alerts where id=$1`, [alert.id])).rows[0]?.sandbox === true);

      console.log('=== reset ===');
      const { resetDemo } = await import('../src/demo/reset.ts');
      await resetDemo('api-proof');
      check('reset removed the API-origin alert', (await c.query(`select count(*)::int n from orbit_alerts where id=$1`, [alert.id])).rows[0].n === 0);
      check('reset removed its response', (await c.query(`select count(*)::int n from orbit_responses where orbit_alert_id=$1`, [alert.id])).rows[0].n === 0);

      console.log('=== seeded consumer reads ===');
      const kids = await gql(mom, `{ myChildren { child { id } scopes } }`);
      check('myChildren answers', (kids.data?.myChildren ?? []).length >= 3, `${(kids.data?.myChildren ?? []).length}`);
      const facts = await gql(mom, `{ careFacts(childId: "p_nora") { key } }`);
      check('careFacts answers', (facts.data?.careFacts ?? []).length >= 1, `${(facts.data?.careFacts ?? []).length}`);
      const ci = await gql(mom, `{ checkInStatus(childId: "p_nora") { recorded dueAt } }`);
      check('checkInStatus answers', !ci.errors, ci.errors?.[0]?.message ?? 'ok');
      const voc = await gql(mom, `{ orbitVocabulary { kind value } }`);
      check('orbitVocabulary answers', (voc.data?.orbitVocabulary ?? []).length >= 1, `${(voc.data?.orbitVocabulary ?? []).length}`);
      const sched = await gql(mom, `{ effectiveScheduleFor(childId: "p_nora", day: "2026-11-26") { source } }`);
      check('effectiveScheduleFor (Thanksgiving) answers', !sched.errors, sched.errors?.[0]?.message ?? 'ok');
      const job = await gql(mom, `{ jobTimeline(jobId: "job_emma_nov05") { type } }`);
      check('jobTimeline answers', !job.errors, job.errors?.[0]?.message ?? 'ok');
      await c.end();
    }
  }
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
