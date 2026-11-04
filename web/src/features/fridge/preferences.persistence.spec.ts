import {test,expect,type Page,type BrowserContext} from '@playwright/test'
const url='/src/features/fridge/fixtures/preferences.html'
async function connect(context:BrowserContext){
 await context.route('**/api/rosina/pin/preferences**',async route=>{
  const source=new URL(route.request().url());source.port='5197'
  const response=await route.fetch({url:source.toString()});await route.fulfill({response})
 })
}
async function loaded(page:Page){await expect(page.getByRole('button',{name:'Arrange items'})).toBeEnabled()}
async function saved(page:Page){await expect(page.getByText('Arrangement saved.',{exact:true})).toBeVisible()}
test('Postgres saves photo and sticky drag, keyboard Arrange, marker styles and Tidy across reload and Andre browser',async({page,context,browser})=>{
 await connect(context);await page.goto(url);await loaded(page)
 await page.getByRole('button',{name:'Tidy up'}).click();await saved(page)
 await page.getByRole('button',{name:'Open collage door'}).click()
 const positions:Record<string,string>={}
 for(const name of ['A quiet afternoon','Open posted note: A fixture sticky']){
  const item=page.getByRole('button',{name,exact:true});await item.scrollIntoViewIfNeeded()
  const before=await item.getAttribute('style'),box=(await item.boundingBox())!
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down()
  await page.mouse.move(box.x+box.width/2+18,box.y+box.height/2+22,{steps:8});await page.mouse.up()
  await saved(page);positions[name]=(await item.getAttribute('style'))!;expect(positions[name]).not.toBe(before)
  await page.reload();await loaded(page);await expect(page.getByRole('button',{name,exact:true})).toHaveAttribute('style',positions[name])
 }
 await page.getByRole('button',{name:'Arrange items'}).click()
 const photo=page.getByRole('button',{name:'A quiet afternoon',exact:true});await photo.focus();await page.keyboard.press('Alt+ArrowRight');await saved(page)
 positions['A quiet afternoon']=(await photo.getAttribute('style'))!
 await page.getByRole('button',{name:'Open goals door'}).click()
 await page.getByRole('button',{name:'blue marker'}).click();await saved(page)
 await page.getByRole('button',{name:'Caveat',exact:true}).click();await saved(page)
 await page.reload();await loaded(page)
 await expect(page.getByRole('button',{name:'Caveat',exact:true})).toHaveAttribute('aria-pressed','true')
 const second=await browser.newContext({viewport:page.viewportSize()!})
 try{
  await connect(second);const andre=await second.newPage();await andre.goto(`${url}?parent=Andre`);await loaded(andre)
  await andre.getByRole('button',{name:'Open collage door'}).click()
  for(const [name,style] of Object.entries(positions))await expect(andre.getByRole('button',{name,exact:true})).toHaveAttribute('style',style)
  await andre.getByRole('button',{name:'Open goals door'}).click()
  await expect(andre.getByRole('button',{name:'blue marker'})).toHaveAttribute('aria-pressed','true')
  await expect(andre.getByRole('button',{name:'Caveat',exact:true})).toHaveAttribute('aria-pressed','true')
  await andre.getByRole('button',{name:'Tidy up'}).click();await saved(andre)
  await page.reload();await loaded(page);await page.getByRole('button',{name:'Open collage door'}).click()
  await expect(page.getByRole('button',{name:'A quiet afternoon',exact:true})).toHaveCSS('left',/./)
  expect(await page.getByRole('button',{name:'A quiet afternoon',exact:true}).getAttribute('style')).not.toBe(positions['A quiet afternoon'])
  await expect(page.getByRole('button',{name:'Open posted note: A fixture sticky'})).not.toHaveClass(/is-arranged/)
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>/^fridge-(layout|markers)/.test(key)))).toEqual([])
 }finally{await second.close()}
})
