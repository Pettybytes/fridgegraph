import {test,expect,type Page} from '@playwright/test'
import {fridgeFamilies} from '../../../../src/fixtures-fridge'
const live=process.env.FRIDGE_FAMILY_LIVE==='1'
async function checkFridge(page:Page,guide:boolean){
 const heading=page.getByRole('heading',{name:'The Fridge',exact:true})
 await expect(heading).toHaveCount(1)
 const subtitle=page.getByText('A little of your family, all in one place.',{exact:true})
 await expect(subtitle).toHaveCount(1)
 const h=await heading.boundingBox(),s=await subtitle.boundingBox()
 expect(s!.y).toBeGreaterThanOrEqual(h!.y+h!.height)
 await expect(page.locator('.fridge-object.photo').first()).toBeVisible()
 expect(await page.locator('.fridge-object.photo').count()).toBeGreaterThanOrEqual(3)
 await expect(page.locator('.fridge-posted-paper[data-note-id^="fridge_demo_note_"]')).toHaveCount(2)
 await expect(page.locator('.fridge-object.event')).toHaveCount(1)
 expect(await page.locator('.fridge-whiteboard h3').count()).toBeGreaterThanOrEqual(2)
 await expect(page.getByRole('alert')).toHaveCount(0)
 if(guide){
  await expect(page.getByText('Read-only perspective. Explore the family collage, notes and goals.')).toBeVisible()
  for(const name of ['Arrange items','Tidy up','Add sticky note','Write on the whiteboard'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0)
 }
 await page.getByRole('button',{name:guide?'View family album':'Add from family album',exact:true}).click()
 expect(await page.locator('.fridge-album-grid button').count()).toBeGreaterThanOrEqual(3)
 await page.getByRole('button',{name:'Close album'}).click()
}
for(const family of fridgeFamilies)test(`fictional ${family.key} guide fridge keeps its complete contents after reload`,async({page})=>{
 test.skip(live,'Fixture coverage runs on the isolated development build')
 await page.goto(`/src/features/fridge/fixtures/family-finishes.html?child=${family.children[0]}&role=guide`)
 await expect(page.getByRole('button',{name:'Family notes (2)'})).toBeVisible()
 await checkFridge(page,true)
 await page.reload()
 await expect(page.getByRole('button',{name:'Family notes (2)'})).toBeVisible()
 await checkFridge(page,true)
})
async function enter(page:Page,name:string){
 const button=page.getByRole('button',{name:`Explore as ${name}`,exact:true})
 const resultPromise=page.waitForResponse(r=>r.url().endsWith('/api/demo/login')&&r.request().method()==='POST')
 await button.click();const result=await resultPromise
 expect(result.ok()).toBe(true)
 if(name==='the Demo guide')await page.getByRole('link',{name:'The Fridge',exact:true}).click()
 await expect(page.getByRole('button',{name:/^Family notes/})).toBeVisible()
}
for(const person of ['the Demo guide','Kendra','Dana'])test(`served ${person} fridge preserves seeded content after reload`,async({page})=>{
 test.skip(!live,'Requires Bentley deployment and the deterministic seed')
 await page.goto('/#/fridge');await enter(page,person)
 await checkFridge(page,person==='the Demo guide')
 if(person!=='Dana'){
  const goal=page.locator('.fridge-whiteboard article').filter({has:page.getByRole('heading',{name:"Bryan hopes to win Meta's AI Dev Indie track",exact:true})})
  await expect(goal).toContainText('November 2026');await expect(goal).toContainText('APPROVED')
  await expect(goal.getByRole('heading')).toHaveCSS('color','rgb(31, 79, 176)')
 }
 await page.reload();await enter(page,person);await checkFridge(page,person==='the Demo guide')
})
for(const [person,child] of [['Kendra','p_nora'],['Dana','p_jax']])test(`fictional ${person} keeps parent controls and full content`,async({page})=>{
 test.skip(live,'Fixture coverage runs on the isolated development build')
 await page.goto(`/src/features/fridge/fixtures/family-finishes.html?child=${child}`)
 await expect(page.getByRole('button',{name:'Family notes (2)'})).toBeVisible()
 await checkFridge(page,false)
 await expect(page.getByRole('button',{name:'Add sticky note',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Arrange items',exact:true})).toBeEnabled()
})
