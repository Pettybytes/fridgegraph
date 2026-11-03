import { defineConfig } from '@playwright/test'

// Pristine gate config. Point it at a running served build with PRISTINE_BASE_URL
// (e.g. PRISTINE_BASE_URL=http://127.0.0.1:5189). When unset it spins up the local
// dev server on its own port so the gate also works standalone.
const external = !!process.env.PRISTINE_BASE_URL
const baseURL = process.env.PRISTINE_BASE_URL ?? 'http://127.0.0.1:4183'

export default defineConfig({
  testDir: './e2e',
  testMatch: /pristine\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  outputDir: './test-results/pristine',
  use: {
    browserName: 'chromium',
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  ...(external ? {} : {
    webServer: {
      command: 'npm run dev -- --host 127.0.0.1 --port 4183 --strictPort',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
    },
  }),
})
