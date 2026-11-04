import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'.',testMatch:'fridge.interactions.spec.ts',workers:1,
 timeout:120000,reporter:'list',outputDir:'/tmp/fridge-interaction-results',
 use:{baseURL:process.env.FRIDGE_TEST_URL??'http://127.0.0.1:5189',channel:'chrome',trace:'off',screenshot:'off'},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'phone',use:{viewport:{width:390,height:844}}}],
})
