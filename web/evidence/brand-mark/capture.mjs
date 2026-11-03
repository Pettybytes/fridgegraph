#!/usr/bin/env node
/**
 * Rendered proof for the FridgeGraph brand mark (docs/brand/README.md). Captures:
 *   - persona picker header, light + dark
 *   - sidebar/header brand mark, light + dark
 *   - a browser-tab proxy (favicon + title, light + dark) — headless Chromium cannot screenshot
 *     real OS tab chrome, so this renders the exact favicon.svg content plus the page's own
 *     <title> at realistic tab scale, which is what a real tab actually displays
 *   - a compact 16/24/40px size comparison of the two mark variants
 *
 * Against the built app (`npm run build && npx vite preview --port 4799`), not the dev server —
 * the same asset the app actually ships. Dark mode has no runtime toggle yet (design.md's token
 * sets are ready, nothing wires prefers-color-scheme to the `.dark` class yet), so dark captures
 * add the class directly — the same CSS the app itself defines, exercised the only way currently
 * possible.
 *
 * Usage: node web/evidence/brand-mark/capture.mjs (preview server must already be running)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const BASE = 'http://127.0.0.1:4799';
mkdirSync(here, { recursive: true });

async function setDark(page, dark) {
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// ── Persona picker ──────────────────────────────────────────────────────────
await page.goto(`${BASE}/#/`);
await page.getByRole('link', { name: 'FridgeGraph' }).waitFor();
await page.screenshot({ path: resolve(here, 'picker-light.png') });
await setDark(page, true);
await page.screenshot({ path: resolve(here, 'picker-dark.png') });
await setDark(page, false);

// ── Sidebar / header (inside a persona session) ─────────────────────────────
await page.getByRole('button', { name: 'Explore as Kendra', exact: true }).click();
await page.getByRole('link', { name: 'FridgeGraph' }).waitFor();
await page.screenshot({ path: resolve(here, 'sidebar-light.png') });
await setDark(page, true);
await page.screenshot({ path: resolve(here, 'sidebar-dark.png') });
await setDark(page, false);

// ── Browser-tab proxy: the real favicon.svg + the real <title>, both schemes ─
const faviconSvg = readFileSync(resolve(here, '../../public/favicon.svg'), 'utf8');
const title = await page.title();
async function tabProxy(dark) {
  // favicon.svg switches color via its OWN embedded @media (prefers-color-scheme) query, not a
  // class — emulate the OS-level signal, the actual mechanism a real browser tab would use.
  const tabPage = await browser.newPage({ viewport: { width: 420, height: 120 }, colorScheme: dark ? 'dark' : 'light' });
  await tabPage.setContent(`<!doctype html><html><head><style>
    html{background:${dark ? '#17151b' : '#f3f1e8'};height:100%}
    body{margin:0;height:100%;display:flex;align-items:center;font-family:ui-sans-serif,system-ui,sans-serif}
    .tab{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:8px 8px 0 0;
      background:${dark ? '#242230' : '#ffffff'};color:${dark ? '#f4f2ea' : '#1c1a2d'};
      box-shadow:0 1px 0 ${dark ? '#000' : '#d8d4c4'};font-size:13px}
    .tab svg{width:16px;height:16px;flex:none}
  </style></head><body><span class="tab">${faviconSvg}<span>${title}</span></span></body></html>`);
  await tabPage.screenshot({ path: resolve(here, `tab-${dark ? 'dark' : 'light'}.png`) });
  await tabPage.close();
}
await tabProxy(false);
await tabProxy(true);

// ── 16 / 24 / 40px size comparison ───────────────────────────────────────────
const simple16 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#434fad" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="3"/><path d="M12 2v20"/><path d="M10.3 6v4.3"/><path d="M13.7 6v4.3"/></svg>`;
const detailed = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#434fad" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="3"/><path d="M12 2v20"/><path d="M10.4 6v4"/><path d="M13.6 6v4"/><path d="M8.3 16.74s-1.76-1.1-1.76-2.42a1.1 1.1 0 0 1 1.76-.88 1.1 1.1 0 0 1 1.76.88c0 1.32-1.76 2.42-1.76 2.42Z" fill="#434fad" stroke="none"/></svg>`;
const sizePage = await browser.newPage({ viewport: { width: 560, height: 220 } });
await sizePage.setContent(`<!doctype html><html><head><style>
  body{margin:0;background:#fff;font-family:ui-sans-serif,system-ui,sans-serif;color:#1c1a2d}
  .row{display:flex;align-items:flex-end;gap:48px;padding:40px}
  .cell{display:flex;flex-direction:column;align-items:center;gap:10px}
  .cell span{font-size:12px;color:#555}
</style></head><body><div class="row">
  <div class="cell">${simple16}<span>16px — FridgeMarkSimple (favicon)</span></div>
  <div class="cell">${detailed(24)}<span>24px — FridgeMark</span></div>
  <div class="cell">${detailed(40)}<span>40px — FridgeMark</span></div>
</div></body></html>`);
await sizePage.screenshot({ path: resolve(here, 'size-comparison-16-24-40.png') });
await sizePage.close();

await browser.close();
console.log('wrote 7 captures to', here);
