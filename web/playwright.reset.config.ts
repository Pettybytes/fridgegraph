import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'./e2e',testMatch:/reset-acceptance\.spec\.ts/,workers:1,fullyParallel:false,timeout:90_000,
 outputDir:'test-results/reset',reporter:'list',
 use:{browserName:'chromium',baseURL:process.env.RESET_BASE_URL??'https://fridgegraph.loomz.stream',viewport:{width:1440,height:900},trace:'off',video:'off',screenshot:'only-on-failure',actionTimeout:10_000},
})
