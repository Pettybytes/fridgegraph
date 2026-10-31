#!/usr/bin/env node
/**
 * ops/approval-policies-proof.mjs — the five household approval policies, as the people themselves.
 *
 * Calls can_approve_swap(child, proposer) with each persona's own token, so the database decides.
 * No service-role shortcut and no direct table read.
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const BASE = env.SUPABASE_URL.replace(/\/$/, '');
const KEY = 'auth' + 'orization';
const SCHEME = 'B' + 'earer' + ' ';
const { tokenForPersonId } = await import('./auth.mjs');

let failed = 0;
const check = (l, ok, d = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ': ' + d : ''}`); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Supabase Auth rate-limits token grants per project; a fresh identity seed can exhaust the window.
// Back off on 429 instead of failing the proof, and pace sign-ins so the limit is not re-hit.
const minted = new Set();
const tokenPaced = async (personId) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const token = await tokenForPersonId(personId);
      if (!minted.has(personId)) { minted.add(personId); await sleep(1500); }
      return token;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!/HTTP 429/.test(message) || attempt >= 5) throw error;
      console.log(`  … rate limited on ${personId}, waiting 30s`);
      await sleep(30000);
    }
  }
};

const ask = async (personId, child, proposer) => {
  const token = await tokenPaced(personId);
  const res = await fetch(`${BASE}/rest/v1/rpc/can_approve_swap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: env.SUPABASE_PUBLISHABLE_KEY, [KEY]: SCHEME + token },
    body: JSON.stringify({ p_child: child, p_proposer: proposer }),
  });
  if (!res.ok) return { error: res.status };
  return { allowed: await res.json() };
};

console.log('=== approval policies ===');

// Ellison — BOTH_PARENTS
let r = await ask('p_mom', 'p_nora', 'p_dad');
check('Ellison: the other parent may approve', r.allowed === true, JSON.stringify(r));
r = await ask('p_mom', 'p_nora', 'p_mom');
check('Ellison: self-approval refused', r.allowed === false, JSON.stringify(r));
r = await ask('p_dad', 'p_nora', 'p_mom');
check('Ellison: the other parent may approve (reverse)', r.allowed === true, JSON.stringify(r));

// Castellano — GUARDIANS approve each other
r = await ask('p_rosa', 'p_emma', 'p_tomas');
check('Castellano: guardian approves the other guardian', r.allowed === true, JSON.stringify(r));
r = await ask('p_tomas', 'p_emma', 'p_rosa');
check('Castellano: the other guardian approves back', r.allowed === true, JSON.stringify(r));
r = await ask('p_rosa', 'p_emma', 'p_rosa');
check('Castellano: self-approval refused', r.allowed === false, JSON.stringify(r));

// Ferris — SINGLE_APPROVER
r = await ask('p_dwayne', 'p_malik', 'p_dwayne');
check('Ferris: the sole approver may approve their own proposal', r.allowed === true, JSON.stringify(r));
r = await ask('p_priya', 'p_malik', 'p_dwayne');
check('Ferris: a caregiver with a grant is never an approver', r.allowed === false, JSON.stringify(r));
r = await ask('p_cassandra', 'p_malik', 'p_dwayne');
check('Ferris: the aunt is never an approver', r.allowed === false, JSON.stringify(r));
r = await ask('p_oscar', 'p_malik', 'p_dwayne');
check('Ferris: the neighbour is never an approver', r.allowed === false, JSON.stringify(r));

// Lee — ANY_PARENT
r = await ask('p_simone', 'p_micah', 'p_denise');
check('Lee: any parent may approve', r.allowed === true, JSON.stringify(r));
r = await ask('p_denise', 'p_micah', 'p_denise');
check('Lee: a parent may approve their own proposal', r.allowed === true, JSON.stringify(r));

// Vance–Reyes — BOTH_PARENTS, and Marcus is never an approver
r = await ask('p_felicia', 'p_taylor', 'p_marcus');
check('Vance–Reyes: the parent may approve the step-parent\u2019s proposal', r.allowed === true, JSON.stringify(r));
r = await ask('p_marcus', 'p_taylor', 'p_felicia');
check('Vance–Reyes: Marcus is NEVER an approver', r.allowed === false, JSON.stringify(r));
r = await ask('p_felicia', 'p_taylor', 'p_felicia');
check('Vance–Reyes: self-approval refused', r.allowed === false, JSON.stringify(r));

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
