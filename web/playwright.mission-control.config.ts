import { defineConfig } from '@playwright/test'

// Read-only acceptance against an already served build. Bentley owns deployment.
export default defineConfig({
  testDir: './e2e', testMatch: /mission-control-drilldowns\.spec\.ts/,
  workers: 1, fullyParallel: false, timeout: 180_000, reporter: 'list',
  outputDir: './test-results/mission-control',
  use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, baseURL: process.env.MC_BASE_URL ?? 'http://127.0.0.1:5189', actionTimeout: 8000, navigationTimeout: 15_000, trace: 'off', video: 'off', screenshot: 'only-on-failure', reducedMotion: 'reduce' },
})
