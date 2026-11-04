import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'.',testMatch:'preferences.persistence.spec.ts',workers:1,timeout:30000,reporter:'list',outputDir:'/tmp/fridge-preferences-browser',
 use:{baseURL:'http://127.0.0.1:5195',channel:'chrome',trace:'off',screenshot:'off'},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}},{name:'phone',use:{viewport:{width:390,height:844}}}],
})
