async page => {
 const root='/Users/user/Desktop/bentley/fridgegraph-fridge-experience/web/evidence/fridge-experience/content-ellison/run-2/'
 const check=(condition,message)=>{if(!condition)throw Error(message)}
 await page.route(/\/api\//,route=>route.abort());await page.route(/\/graphql(?:\?|$)/,route=>route.abort())
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.goto('http://127.0.0.1:5238/evidence/fridge-experience/content-ellison/preview.html#/fridge');await page.reload()
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
 await page.getByRole('button',{name:'Open collage door',exact:true}).click()
 const dog=page.getByRole('button',{name:'The family dog',exact:true})
 await dog.click();check(await page.getByRole('dialog').count()===1,'Photo tap opens dialog')
 await page.getByRole('button',{name:'Close',exact:true}).click()
 await dog.focus();await page.keyboard.press('Alt+ArrowRight')
 check(await dog.evaluate(el=>parseFloat(el.style.left))>21.3,'Keyboard layout movement')
 await dog.scrollIntoViewIfNeeded()
 const before=await dog.evaluate(el=>parseFloat(el.style.left))
 const box=await dog.boundingBox();check(!!box,'Dog geometry')
 const cdp=await page.context().newCDPSession(page)
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]})
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width/2+15,y:box.y+box.height/2+10}]})
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
 await cdp.detach()
 check(await page.getByRole('dialog').count()===0,'Touch drag does not activate photo')
 check(await dog.evaluate(el=>parseFloat(el.style.left))>before,'Touch drag moves layout')
 await page.getByRole('button',{name:'Tidy up',exact:true}).click()
 await page.getByRole('button',{name:'Open goals door',exact:true}).click()
 for(let i=0;i<18;i++){await page.keyboard.press('Tab');check(!await page.evaluate(()=>document.activeElement?.closest('[data-fridge-door="notes"]')),'Clipped door excluded from keyboard')}
 await page.keyboard.press('Escape');check(await page.locator('.fridge-viewport').getAttribute('data-view')==='overview','Escape syncs overview')
 await page.getByRole('button',{name:'Switch person',exact:true}).click()
 await page.getByRole('button',{name:'Explore as the Demo guide',exact:true}).click()
 await page.getByRole('link',{name:'The Fridge',exact:true}).click()
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:900})
  for(const state of ['refused','failed']){
   await page.getByRole('combobox',{name:'Preview source state'}).selectOption(state)
   await page.getByRole('button',{name:'Open collage door',exact:true}).click()
   if(state==='failed'){await page.getByRole('button',{name:'Retry care notes',exact:true}).click();await page.getByText("Couldn't load",{exact:true}).waitFor()}
   else await page.getByText('Not shared with this perspective.',{exact:true}).waitFor()
   check((await page.locator('.fridge-caption').innerText()).includes('Read-only perspective'),'Guide label')
   await page.locator('.fridge-feedback').scrollIntoViewIfNeeded()
   await page.screenshot({path:`${root}guide-${state}-${width}.png`,fullPage:width===1440})
  }
 }
 return 'PASS photo tap, touch-pointer drag, keyboard movement, hidden-door Tab exclusion, Escape, reduced motion, guide refusal and explicit failure retry.'
}
