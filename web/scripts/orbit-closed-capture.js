async page=>{
 const results=[];let backendCalls=0;page.on('request',r=>{if(/\/(api|graphql)(\/|$)/.test(new URL(r.url()).pathname))backendCalls++});
 for(const width of [1440,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:width===390?844:900});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:5195/scripts/orbit-alert-review.html?mode=recipient-closed');
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.getByRole('heading',{name:'Found safe',exact:true}).waitFor();
  const dialog=page.getByRole('dialog');if(await dialog.locator('img').count())throw Error('Closed view retained photo');
  const text=await dialog.innerText();if(/Riverside Park|blue|shirt|backpack|Ellison/.test(text))throw Error('Closed view retained private details');
  if(await dialog.locator('.orbit-confetti').count())throw Error('Cold link replayed confetti');
  await page.screenshot({path:`web/evidence/orbit-alert/offline-03/${width}-${theme}-closed-link.png`});results.push({width,theme,closedLinkPrivateDetailsAbsent:true,noConfettiReplay:true});
 }
 if(backendCalls)throw Error('Unexpected backend request');return {results,backendCalls};
}
