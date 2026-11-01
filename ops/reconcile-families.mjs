#!/usr/bin/env node
/**
 * ops/reconcile-families.mjs — reconcile abandoned demo-family accounts.
 *
 * Every `family.*@example.com` auth user that is NOT an active `demo_families` row is stray: an
 * aborted run that never wrote a mapping. This deletes the account, its rows, both mappings and the
 * marker. Counts only are printed — never ids or emails.
 *
 * Run: node --import tsx ops/reconcile-families.mjs
 */
import { loadEnv } from '../src/env.ts';
loadEnv();
const { reconcileAbandonedFamilies } = await import('../src/demo/family.ts');

const out = await reconcileAbandonedFamilies();
console.log(JSON.stringify({ ...out, mode: 'reconcile' }));
process.exit(0);
