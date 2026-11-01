async(page)=>{
 const results=[],calls=[];page.on('request',r=>{if(/\/(api|graphql)(\/|$)/.test(new URL(r.url()).pathname))calls.push('backend')});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:900});await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('http://127.0.0.1:5195/scripts/orbit-alert-review.html?mode=recipient');await page.getByRole('dialog').waitFor();await page.getByAltText('Photo shared by the parent').waitFor();await page.waitForFunction(()=>document.querySelector('.orbit-alert-subject img')?.complete);
  const flash=await page.locator('.orbit-takeover').evaluate(el=>({duration:getComputedStyle(el,'::before').animationDuration,name:getComputedStyle(el,'::before').animationName}));if(flash.duration!=='1s')throw Error('Flash frequency is not 1 Hz');
  for(const button of await page.locator('.orbit-alert-actions button').all()){const box=await button.boundingBox();if(box.height<44)throw Error('Response target too small')}
  await page.screenshot({path:`web/evidence/orbit-alert/offline-03/${width}-recipient.png`});
  await page.getByRole('button',{name:"I'm on my way",exact:true}).click();await page.getByText(/You reported: on my way/).waitFor();if(await page.getByRole('button',{name:'Found safe',exact:true}).count())throw Error('Recipient may close');
  await page.evaluate(()=>window.dispatchEvent(new Event('controlled:close')));await page.getByText('Found safe',{exact:true}).waitFor();if(await page.locator('.orbit-takeover img').count()||await page.getByText('Riverside Park',{exact:true}).count()||await page.getByText('blue',{exact:true}).count())throw Error('Closed recipient details retained');await page.waitForTimeout(1900);await page.screenshot({path:`web/evidence/orbit-alert/offline-03/${width}-found.png`});
  await page.evaluate(()=>window.dispatchEvent(new Event('controlled:close')));await page.waitForTimeout(200);if(await page.locator('.orbit-confetti').count())throw Error('Confetti replayed');
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('http://127.0.0.1:5195/scripts/orbit-alert-review.html?mode=recipient');await page.getByRole('dialog').waitFor();const reduced=await page.locator('.orbit-takeover').evaluate(el=>getComputedStyle(el,'::before').animationName);if(reduced!=='none')throw Error('Reduced motion still flashing');await page.evaluate(()=>window.dispatchEvent(new Event('controlled:close')));await page.getByText('Found safe',{exact:true}).waitFor();if(await page.locator('.orbit-confetti').count())throw Error('Reduced motion confetti');
  await page.goto('http://127.0.0.1:5195/scripts/orbit-alert-review.html?mode=parent');await page.getByRole('button',{name:'Found safe',exact:true}).waitFor();await page.screenshot({path:`web/evidence/orbit-alert/offline-03/${width}-parent.png`,fullPage:true});await page.getByRole('button',{name:'Found safe',exact:true}).click();await page.getByRole('button',{name:'Confirm found safe',exact:true}).click();await page.getByRole('region',{name:'Found safe',exact:true}).waitFor();
  results.push({width,flashHz:1,reducedMotionStatic:true,recipientCannotClose:true,parentExplicitFoundSafe:true,noReplay:true});
 }
 if(calls.length)throw Error('Offline test made a backend call');return {results,backendCalls:calls.length};
}
