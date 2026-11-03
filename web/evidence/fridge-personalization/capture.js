async page=>{
 const root='/Users/user/Desktop/bentley/fridgegraph-fridge-personalization/web/evidence/fridge-personalization/'
 let calls=0;page.on('request',r=>{if(/\/api\/|\/graphql(?:\?|$)/.test(r.url()))calls++})
 await page.route(/\/api\/|\/graphql(?:\?|$)/,r=>r.abort())
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:900})
  await page.goto('http://127.0.0.1:5244/evidence/fridge-personalization/preview.html#/fridge');await page.reload()
  await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
  await page.getByRole('button',{name:'Manage goals'}).waitFor()
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))})
  await page.getByRole('region',{name:'Fridge viewer'}).evaluate(e=>e.scrollIntoView({block:'center'}))
  await page.screenshot({path:root+'family-'+width+'.png',fullPage:true})
  await page.getByRole('button',{name:'Add from family album'}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByRole('button',{name:'On the porch',exact:true}).click()
  await dialog.getByRole('region',{name:'Artwork preview'}).scrollIntoViewIfNeeded()
  await dialog.locator('img').evaluateAll(imgs=>Promise.all(imgs.filter(i=>i.getBoundingClientRect().bottom>0&&i.getBoundingClientRect().top<innerHeight).map(i=>i.decode().catch(()=>{}))))
  await page.screenshot({path:root+'album-'+width+'.png'})
  if(!await dialog.getByRole('button',{name:'Pin to fridge unavailable'}).isDisabled())throw Error('Unverified pin enabled')
  await page.getByRole('button',{name:'Close album'}).click()
  await page.getByRole('button',{name:'Switch person'}).click()
  const next=page.getByRole('button',{name:"Explore as Jax's family",exact:true})
  await next.waitFor();await next.click()
  await page.getByRole('link',{name:'The Fridge',exact:true}).click()
  await page.getByText(/There’s no artwork in this family album yet/).waitFor()
  if(await page.getByRole('button',{name:'The family dog',exact:true}).count())throw Error('Foreign family art leaked')
  await page.getByRole('region',{name:'Fridge viewer'}).evaluate(e=>e.scrollIntoView({block:'center'}))
  await page.screenshot({path:root+'neutral-'+width+'.png',fullPage:true})
 }
 if(calls)throw Error('Unexpected backend request')
 return {captures:6,backendRequests:calls,familyAndNeutral:true,albumPersistenceDisabled:true}
}
