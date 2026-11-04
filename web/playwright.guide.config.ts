import { defineConfig } from '@playwright/test'
export default defineConfig({
 testDir:'./e2e',testMatch:/(demo-guide-scope|map-perspective-scope|calendar-actions)\.spec\.ts/,workers:1,expect:{timeout:45_000},timeout:600_000,reporter:'list',
 outputDir:'./test-results/guide-scope',
 use:{actionTimeout:30_000,baseURL:process.env.GUIDE_BASE_URL??'http://127.0.0.1:5196',browserName:'chromium',trace:'off',video:'off',screenshot:'only-on-failure',reducedMotion:'reduce'},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
})
