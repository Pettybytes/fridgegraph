async page=>{
 const root='/Users/user/Desktop/bentley/fridgegraph-fridge-editing-integration/web/evidence/fridge-editing-integration/'
 const check=(ok,message)=>{if(!ok)throw Error(message)}
 await page.route(/\/api\//,r=>r.abort());await page.route(/\/graphql(?:\?|$)/,r=>r.abort())
 const align=async locator=>locator.evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement){if(getComputedStyle(p).overflowY==='auto'&&p.scrollHeight>p.clientHeight){p.scrollTop+=el.getBoundingClientRect().top-80;return}}})
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:900})
  await page.goto('http://127.0.0.1:5241/evidence/fridge-editing-integration/preview.html#/fridge');await page.reload()
  await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
  for(const mode of ['absent','authentication','refused','network','database','failed']){
   await page.getByRole('combobox',{name:'Preview capability'}).selectOption(mode)
   await page.locator('.fridge-phase2-state').waitFor()
   await page.waitForFunction(()=>!document.querySelector('.fridge-phase2-state')?.textContent?.includes('Checking'))
   check(await page.getByRole('button',{name:'Manage goals',exact:true}).count()===0,'No actions during capability failure')
   check((await page.getByRole('region',{name:'Recorded goals'}).innerText()).includes('Read together after school'),'Phase 1 survives')
   await align(page.locator('.fridge-phase2-state'))
   await page.screenshot({path:`${root}${mode}-${width}.png`,fullPage:width===1440})
  }
  await page.getByRole('combobox',{name:'Preview capability'}).selectOption('ready')
  await page.getByRole('button',{name:'Switch person',exact:true}).click()
  await page.getByRole('button',{name:'Explore as Priya',exact:true}).click()
  await page.getByRole('link',{name:'The Fridge',exact:true}).click()
  await page.getByRole('button',{name:/^Family notes/}).click()
  await page.getByText('Fridge notes are not shared with this perspective.',{exact:true}).waitFor()
  check(await page.getByRole('button',{name:'Post privately',exact:true}).count()===0,'Caregiver no write')
  await page.screenshot({path:`${root}caregiver-refused-${width}.png`})
  await page.getByRole('button',{name:'Close editor'}).click()
  await page.getByRole('button',{name:'Switch person',exact:true}).click()
  await page.getByRole('button',{name:'Explore as the Demo guide',exact:true}).click()
  await page.getByRole('link',{name:'The Fridge',exact:true}).click()
  await page.getByRole('button',{name:/^Family notes/}).click()
  await page.getByText('Fridge notes are not shared with this perspective.',{exact:true}).waitFor()
  check(await page.getByRole('button',{name:'Post privately',exact:true}).count()===0,'Guide no write')
  await page.screenshot({path:`${root}guide-read-only-${width}.png`})
 }
 return 'PASS capability absent/auth/refused/network/database/failure remain distinct, Phase 1 stays readable, caregiver/guide no writes, perspective switch clears prior edits.'
}
