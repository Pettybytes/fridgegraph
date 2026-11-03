import { defineConfig } from '@playwright/test'

// Judge-path smoke config. Point it at any running instance with JUDGE_BASE_URL
// (e.g. JUDGE_BASE_URL=http://localhost:5189 now, or a public hostname later).
// When JUDGE_BASE_URL is unset it falls back to spinning up the local dev server,
// matching the shared e2e config's port so it works standalone.
const external = !!process.env.JUDGE_BASE_URL
const baseURL = process.env.JUDGE_BASE_URL ?? 'http://127.0.0.1:4182'

export default defineConfig({
  testDir: './e2e',
  testMatch: /judge-path\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: './test-results/judge-path',
  use: {
    browserName: 'chromium',
    baseURL,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'off', // step screenshots are taken explicitly by the spec
  },
  ...(external ? {} : {
    webServer: {
      command: 'npm run dev -- --host 127.0.0.1 --port 4182 --strictPort',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
    },
  }),
})
