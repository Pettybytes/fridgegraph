#!/usr/bin/env node
// One-off export: renders docs/brand/fridgegraph-mark-512.svg to a transparent 512x512 PNG.
// Run with: node web/scripts/export-brand-mark-png.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../..');
const svgPath = resolve(repoRoot, 'docs/brand/fridgegraph-mark-512.svg');
const outPath = resolve(repoRoot, 'docs/brand/fridgegraph-mark-512.png');
const svg = readFileSync(svgPath, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>${svg}</body></html>`);
await page.locator('svg').screenshot({ path: outPath, omitBackground: true });
await browser.close();
console.log(`wrote ${outPath}`);
