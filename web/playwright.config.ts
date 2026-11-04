import { defineConfig } from '@playwright/test'
// On a shared machine, `reuseExistingServer` can silently attach to another checkout's dev server
// on 4182 and test the wrong code. E2E_BASE_URL points the run at a server you started yourself
// (any port) and skips the managed webServer; unset, everything behaves as before.
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4182'
export default defineConfig({
  testDir: './e2e',
  // The judge-path smoke test targets an external running instance via its own config
  // (playwright.judge.config.ts) — keep it out of the default local e2e run.
  testIgnore: /judge-path\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: './test-results',
  use: { channel: 'chrome', baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-390', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: 'npm run dev -- --host 127.0.0.1 --port 4182 --strictPort', url: baseURL, reuseExistingServer: !process.env.CI },
})
