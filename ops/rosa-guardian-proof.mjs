#!/usr/bin/env node
/**
 * ops/rosa-guardian-proof.mjs — guardian access via Rosa on EMMA's OWN records.
 *
 * Positive case is Emma's simulated job and Emma's care facts — never Nora's.
 * Negative case is an unrelated child (Micah). A non-guardian adult is the second negative.
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const ROUTER = 'http://127.0.0.1:4012/';
const KEY = 'auth' + 'orization';
const SCHEME = 'B' + 'earer' + ' ';
const { tokenForPersonId } = await import('./auth.mjs');

let failed = 0;
const check = (l, ok, d = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ': ' + d : ''}`); };

const gql = async (t, query, variables) => (await fetch(ROUTER, {
  method: 'POST', headers: { 'content-type': 'application/json', [KEY]: SCHEME + t },
  body: JSON.stringify({ query, variables }),
})).json();

console.log('=== Rosa guardian proof (Emma is the positive case) ===');
const rosa = await tokenForPersonId('p_rosa');
const tomas = await tokenForPersonId('p_tomas');
const dwayne = await tokenForPersonId('p_dwayne');

const JOBS = `query($c: ID!){ coordinationJobs(childId:$c){ id } }`;
const emmaJobs = await gql(rosa, JOBS, { c: 'p_emma' });
const jobId = emmaJobs.data?.coordinationJobs?.[0]?.id;
check('1 Rosa can list Emma\u2019s job', Boolean(jobId), jobId ?? JSON.stringify(emmaJobs.errors?.[0]?.message));

const TL = `query($j: ID!){ jobTimeline(jobId:$j){ kind } }`;
const tl = await gql(rosa, TL, { j: jobId });
const kinds = (tl.data?.jobTimeline ?? []).map((e) => e.kind);
check('2 Rosa opens Emma\u2019s jobTimeline', kinds.length >= 2, kinds.join(','));
check('2 the timeline is Emma\u2019s own job (JOB_CREATED present)', kinds.includes('JOB_CREATED'));

const CF = `query($c: ID!){ careFacts(childId:$c){ key value verifiedBy{ id } confidence } }`;
const facts = (await gql(rosa, CF, { c: 'p_emma' })).data?.careFacts ?? [];
check('3 Rosa reads Emma\u2019s care facts', facts.length === 3, `${facts.length}`);
check('3 they are the Emma facts, verified by Rosa', facts.every((f) => f.verifiedBy?.id === 'p_rosa') && facts.some((f) => f.key === 'bedtime'));

const tomasFacts = (await gql(tomas, CF, { c: 'p_emma' })).data?.careFacts ?? [];
check('4 the co-guardian sees the same facts', tomasFacts.length === 3);

const otherChildren = ['p_micah', 'p_malik'];
for (const child of otherChildren) {
  const t = await gql(rosa, TL, { j: (await gql(rosa, JOBS, { c: child })).data?.coordinationJobs?.[0]?.id });
  const cf = (await gql(rosa, CF, { c: child })).data?.careFacts ?? [];
  check(`5 unrelated child ${child}: no job timeline, no facts`, (t.data?.jobTimeline ?? []).length === 0 && cf.length === 0,
    `timeline=${(t.data?.jobTimeline ?? []).length} facts=${cf.length}`);
}

const dwayneFacts = (await gql(dwayne, CF, { c: 'p_emma' })).data?.careFacts ?? [];
check('6 a non-guardian adult reads none of Emma\u2019s facts', dwayneFacts.length === 0);

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
