import {test,expect} from '@playwright/test'

// Reloading must restore the same persona on the same route by re-running the
// server-side persona pick; browser storage holds only the persona id (#28:
// no access or refresh token ever reaches browser storage).
test('reload on Orbit as Kendra stays on Orbit as Kendra', async ({page})=>{
 await page.goto('/')
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
 await expect(page.getByRole('button',{name:'Leave perspective',exact:true})).toBeVisible()
 await page.evaluate(()=>{location.hash='/orbit'})
 await expect(page).toHaveURL(/#\/orbit/)
 await page.reload()
 await expect(page.getByRole('button',{name:'Leave perspective',exact:true})).toBeVisible({timeout:30000})
 await expect(page).toHaveURL(/#\/orbit/)
 await expect(page.locator('body')).toContainText('Exploring as Kendra')
 const stored=await page.evaluate(()=>{const v:string[]=[];for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i)!;v.push(`${k}=${sessionStorage.getItem(k)}`)}for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)!;v.push(`${k}=${localStorage.getItem(k)}`)}return v.join('\n')})
 expect(stored).toContain('fg:perspective=kendra')
 expect(stored).not.toMatch(/token|accessToken|refresh/i)
})

test('reload after leaving to the picker shows the picker', async ({page})=>{
 await page.goto('/')
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
 await expect(page.getByRole('button',{name:'Leave perspective',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Leave perspective',exact:true}).click()
 await expect(page.getByRole('button',{name:'Explore as Kendra',exact:true})).toBeVisible({timeout:30000})
 await page.reload()
 await expect(page.getByRole('button',{name:'Explore as Kendra',exact:true})).toBeVisible({timeout:30000})
 await expect(page.getByRole('button',{name:'Leave perspective',exact:true})).toHaveCount(0)
})

test('two tabs with different personas stay isolated', async ({context})=>{
 test.setTimeout(180000)
 const a=await context.newPage(),b=await context.newPage()
 await a.goto('/');await a.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
 await expect(a.getByRole('button',{name:'Leave perspective',exact:true})).toBeVisible({timeout:30000})
 await b.goto('/');await b.getByRole('button',{name:'Explore as Dana',exact:true}).click()
 await expect(b.getByRole('button',{name:'Leave perspective',exact:true})).toBeVisible({timeout:30000})
 await a.reload();await b.reload()
 // Per-tab sessionStorage is the isolation boundary: each tab re-picks only its own persona.
 await expect(a.getByRole('button',{name:'Leave perspective',exact:true})).toBeVisible({timeout:30000})
 await expect(b.getByRole('button',{name:'Leave perspective',exact:true})).toBeVisible({timeout:30000})
 expect(await a.evaluate(()=>sessionStorage.getItem('fg:perspective'))).toBe('kendra')
 expect(await b.evaluate(()=>sessionStorage.getItem('fg:perspective'))).toBe('dana')
 await expect(a.locator('body')).toContainText('Kendra')
 await expect(b.locator('body')).toContainText('Dana')
})

test('reload after Reset shows the picker', async ({page})=>{
 test.setTimeout(180000)
 test.skip(process.env.RESET_ALLOW_SHARED!=='1','Set RESET_ALLOW_SHARED=1 only for the coordinated reset rehearsal.')
 await page.goto('/')
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
 await expect(page.getByRole('button',{name:'Leave perspective',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Reset demo',exact:true}).click()
 await page.getByRole('button',{name:'Reset demo for everyone',exact:true}).click()
 await expect(page.locator('.reset-demo-toast')).toHaveText('Demo reset.',{timeout:15000})
 await page.reload()
 await expect(page.getByRole('button',{name:'Explore as Kendra',exact:true})).toBeVisible({timeout:30000})
 await expect(page.getByRole('button',{name:'Leave perspective',exact:true})).toHaveCount(0)
})
