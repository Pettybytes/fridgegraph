import {test,expect,type Page} from '@playwright/test'
import path from 'node:path'
const stamp=()=>`Fridge check ${Date.now()}`
async function login(page:Page,person='Kendra'){
 const button=page.getByRole('button',{name:`Explore as ${person}`,exact:true})
 for(let attempt=0;attempt<2;attempt++){
  const response=page.waitForResponse(r=>r.url().endsWith('/api/demo/login')&&r.request().method()==='POST')
  await button.click()
  const result=await response
  if(result.status()!==429){expect(result.ok()).toBe(true);return}
  // Full reloads mint a new demo session. Respect the server's per-persona limit.
  const seconds=Number(result.headers()['retry-after'])
  expect(seconds).toBeGreaterThan(0)
  await new Promise(resolve=>setTimeout(resolve,Math.min(seconds,60)*1000))
 }
 throw new Error('Demo login remained rate limited after Retry-After')
}
async function enter(page:Page,person='Kendra'){
 await page.goto('/#/fridge')
 await login(page,person)
 await expect(page.getByRole('button',{name:/^Family notes/})).toBeVisible()
}
async function reload(page:Page,door='notes'){
 await page.reload()
 await login(page)
 await page.getByRole('button',{name:`Open ${door==='notes'?'collage':'goals'} door`,exact:true}).click()
}
async function removeNote(page:Page,text:string){
 if(await page.getByRole('button',{name:'Close',exact:true}).isVisible())await page.getByRole('button',{name:'Close',exact:true}).click()
 if(!await page.getByRole('dialog').isVisible())await page.getByRole('button',{name:/^Family notes/}).click()
 const note=page.locator('.fe-note').filter({has:page.getByText(text,{exact:true})})
 if(await note.count()){
  await note.getByRole('button',{name:'Remove',exact:true}).click()
  await note.getByRole('button',{name:'Confirm remove'}).click()
  await expect(note).toHaveCount(0)
 }
 if(await page.getByRole('button',{name:'Close editor'}).isVisible())await page.getByRole('button',{name:'Close editor'}).click()
}

test('upload, caption and Add to fridge survive reload and a second parent browser',async({page,browser})=>{
 const caption=stamp()
 await enter(page)
 const other=await browser.newContext()
 try{
  await page.getByLabel('Choose a photo or paper to pin').setInputFiles(path.resolve(import.meta.dirname,'../../../public/fridge/packs/ellison/pack_candid_kitchen-1024.webp'))
  await expect(page.getByRole('button',{name:'Add to fridge',exact:true})).toBeEnabled()
  await page.getByRole('textbox',{name:'Caption (optional)'}).fill(caption)
  await page.getByRole('button',{name:'Add to fridge',exact:true}).click()
  await expect(page.getByText(/Pinned to the fridge/)).toBeVisible()
  await reload(page)
  await expect(page.getByRole('button',{name:`Open posted note: ${caption}`,exact:true})).toBeVisible()
  await expect(page.getByRole('img',{name:caption,exact:true})).toBeVisible()
  const andre=await other.newPage();await enter(andre,'Andre')
  await andre.getByRole('button',{name:'Open collage door'}).click()
  await expect(andre.getByRole('img',{name:caption,exact:true})).toBeVisible()
 }finally{await other.close();await removeNote(page,caption)}
})

test('collage caption requires Save and is read from the server after reload',async({page,browser})=>{
 const caption=stamp();await enter(page)
 const other=await browser.newContext()
 try{
  await page.getByRole('button',{name:'Open collage door'}).click()
  await page.getByRole('button',{name:'The family dog',exact:true}).click()
  await page.getByRole('textbox',{name:'Edit caption for The family dog'}).fill(caption)
  await page.getByRole('button',{name:'Save',exact:true}).click()
  await expect(page.getByText('Saved.',{exact:true})).toBeVisible()
  await reload(page)
  await page.getByRole('button',{name:'The family dog',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Edit caption for The family dog'})).toHaveValue(caption)
  const andre=await other.newPage();await enter(andre,'Andre')
  await andre.getByRole('button',{name:'Open collage door'}).click()
  await andre.getByRole('button',{name:'The family dog',exact:true}).click()
  await expect(andre.getByRole('textbox',{name:'Edit caption for The family dog'})).toHaveValue(caption)
 }finally{await other.close();await removeNote(page,caption)}
})

test('sticky create, edit and delete persist after reload',async({page})=>{
 const text=stamp(),edited=`${text} edited`;await enter(page)
 try{
  await page.getByRole('button',{name:'Open collage door'}).click()
  await page.getByRole('button',{name:'Add sticky note',exact:true}).click()
  await page.getByRole('textbox',{name:'Note text',exact:true}).fill(text)
  await page.getByRole('button',{name:'Post privately'}).click()
  await expect(page.getByText('Saved.',{exact:true})).toBeVisible()
  await reload(page)
  await expect(page.getByRole('button',{name:`Open posted note: ${text}`,exact:true})).toBeVisible()
  await page.getByRole('button',{name:/^Family notes/}).click()
  const note=page.locator('.fe-note').filter({has:page.getByText(text,{exact:true})})
  await note.getByRole('button',{name:'Edit note'}).click()
  await page.getByRole('form',{name:'Edit fridge note'}).getByRole('textbox',{name:'Note text',exact:true}).fill(edited)
  await page.getByRole('form',{name:'Edit fridge note'}).getByRole('button',{name:'Save note'}).click()
  await expect(page.getByText('Saved.',{exact:true})).toBeVisible()
  await reload(page)
  await expect(page.getByRole('button',{name:`Open posted note: ${edited}`,exact:true})).toBeVisible()
  await removeNote(page,edited)
  await reload(page)
  await expect(page.getByRole('button',{name:`Open posted note: ${edited}`,exact:true})).toHaveCount(0)
 }finally{await removeNote(page,text);await removeNote(page,edited)}
})

test('whiteboard create, edit, horizon and marker choices survive reload',async({page,browser})=>{
 const title=stamp(),edited=`${title} edited`;await enter(page)
 const other=await browser.newContext()
 try{
  await page.getByRole('button',{name:'Open goals door'}).click()
  await page.getByRole('button',{name:'Write on the whiteboard'}).click()
  const form=page.getByRole('form',{name:/Write a goal on the whiteboard|Add a goal/})
  await form.getByRole('textbox',{name:'Goal title'}).fill(title)
  await form.getByRole('textbox',{name:/Horizon/}).fill('Next summer')
  await form.getByRole('button',{name:'Add goal',exact:true}).click()
  if(await page.getByRole('button',{name:'Close editor'}).isVisible())await page.getByRole('button',{name:'Close editor'}).click()
  const marker=page.getByRole('group',{name:`Marker for ${title}`})
  await marker.getByRole('button',{name:'blue marker'}).click()
  await marker.getByRole('button',{name:'Caveat'}).click()
  await reload(page,'goals')
  const goal=page.locator('.fridge-whiteboard article').filter({has:page.getByRole('heading',{name:title,exact:true})})
  await expect(goal).toContainText('Next summer')
  await expect(goal.getByRole('button',{name:'blue marker'})).toHaveAttribute('aria-pressed','true')
  await expect(goal.getByRole('button',{name:'Caveat'})).toHaveAttribute('aria-pressed','true')
  await page.getByRole('button',{name:'Manage goals'}).click()
  await page.locator('.fe-goal').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Edit',exact:true}).click()
  const edit=page.getByRole('form',{name:`Edit ${title}`,exact:true})
  await edit.getByRole('textbox',{name:'Goal title'}).fill(edited)
  await edit.getByRole('textbox',{name:/Horizon/}).fill('This winter')
  await edit.getByRole('button',{name:'Save goal'}).click()
  await expect(page.getByText('Saved.',{exact:true})).toBeVisible()
  await reload(page,'goals')
  const updated=page.locator('.fridge-whiteboard article').filter({has:page.getByRole('heading',{name:edited,exact:true})})
  await expect(updated).toContainText('This winter')
  const second=await other.newPage();await enter(second,'Andre')
  await second.getByRole('button',{name:'Open goals door'}).click()
  await expect(second.locator('.fridge-whiteboard article').filter({has:second.getByRole('heading',{name:edited,exact:true})})).toContainText('This winter')
 }finally{
  await other.close()
  if(await page.getByRole('button',{name:'Close editor'}).isVisible())await page.getByRole('button',{name:'Close editor'}).click()
  await page.getByRole('button',{name:'Manage goals'}).click()
  const goal=page.locator('.fe-goal').filter({has:page.getByRole('heading',{name:new RegExp(`^${title}( edited)?$`)})})
  if(await goal.count()){await goal.getByRole('button',{name:'Delete',exact:true}).click();await goal.getByRole('button',{name:'Confirm delete'}).click();await expect(goal).toHaveCount(0)}
 }
})

test('photo drag persists after reload and in a second browser',async({page,browser})=>{
 await enter(page);await page.getByRole('button',{name:'Open collage door'}).click()
 const photo=page.getByRole('button',{name:'The family dog',exact:true})
 const before=await photo.getAttribute('style'),box=await photo.boundingBox();expect(box).not.toBeNull()
 await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2)
 await page.mouse.down();await page.mouse.move(box!.x+box!.width/2+24,box!.y+box!.height/2+35,{steps:10});await page.mouse.up()
 const moved=await photo.getAttribute('style');expect(moved).not.toBe(before)
 await reload(page);await expect(photo).toHaveAttribute('style',moved!)
 const other=await browser.newContext()
 try{
  const second=await other.newPage();await enter(second)
  await second.getByRole('button',{name:'Open collage door'}).click()
  await expect(second.getByRole('button',{name:'The family dog',exact:true})).toHaveAttribute('style',moved!)
 }finally{await other.close();await page.getByRole('button',{name:'Tidy up'}).click()}
})
