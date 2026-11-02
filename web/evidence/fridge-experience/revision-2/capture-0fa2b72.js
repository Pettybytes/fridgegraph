async page => {
 const base='http://127.0.0.1:5238/evidence/fridge-experience/preview.html';
 const dir='/Users/user/Desktop/bentley/fridgegraph-fridge-experience/web/evidence/fridge-experience/revision-2/0fa2b72/';
 const browser=page.context().browser();
 const context=await browser.newContext();const p=await context.newPage();const external=[];const fonts=[];
 p.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:5238/'))external.push(r.url());if(r.resourceType()==='font')fonts.push(r.url())});
 const settle=async()=>{await p.evaluate(()=>document.fonts.ready);await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))};
 const shot=async name=>{await settle();await p.screenshot({path:dir+name+'.png',fullPage:true})};
 for(const [size,width,height] of [['desktop',1440,1000],['phone',390,844]]){
  await p.setViewportSize({width,height});await p.goto(base+'#/fridge');await p.getByLabel('Preview perspective').selectOption('populated');
  await p.getByRole('button',{name:'Open Orbit Alert',exact:true}).waitFor();
  await shot(size+'-populated-overview');
  await p.getByRole('button',{name:'Open collage door',exact:true}).click();await shot(size+'-populated-collage');
  await p.getByRole('button',{name:'Open goals door',exact:true}).click();await shot(size+'-goals');
  await p.getByLabel('Preview perspective').selectOption('guide');await p.getByText('Read-only perspective.',{exact:false}).waitFor();await shot(size+'-guide');
  await p.getByLabel('Preview perspective').selectOption('empty');await p.getByRole('button',{name:'Open collage door',exact:true}).click();await p.getByText('Nothing posted yet.',{exact:true}).first().waitFor();await shot(size+'-empty-collage');
  await p.getByRole('button',{name:'← Back to fridge',exact:true}).click();await shot(size+'-empty-overview');
  await p.getByLabel('Preview perspective').selectOption('refused');await p.getByRole('button',{name:'Open collage door',exact:true}).click();await p.getByText('Not shared with this perspective.',{exact:true}).first().waitFor();await shot(size+'-refused');
  await p.getByLabel('Preview perspective').selectOption('failed');await p.getByRole('button',{name:'Retry care notes',exact:true}).waitFor();await shot(size+'-failure');
  await p.getByRole('button',{name:'Retry care notes',exact:true}).click();await p.getByRole('button',{name:'Retry care notes',exact:true}).waitFor();
  // Actual browser Tab traversal: no focused element may belong to the clipped door.
  await p.getByRole('button',{name:'Open collage door',exact:true}).focus();
  for(let i=0;i<14;i++){await p.keyboard.press('Tab');if(await p.evaluate(()=>document.activeElement?.closest('[data-fridge-door]')?.getAttribute('data-fridge-door')==='goals'))throw Error('Clipped goals focus')}
  await p.getByRole('button',{name:'Open goals door',exact:true}).click();
  for(let i=0;i<14;i++){await p.keyboard.press('Tab');if(await p.evaluate(()=>document.activeElement?.closest('[data-fridge-door]')?.getAttribute('data-fridge-door')==='notes'))throw Error('Clipped notes focus')}
 }
 await p.goto(base+'#/fridge');await p.getByRole('button',{name:'Open collage door',exact:true}).click();await p.getByRole('button',{name:'Open goals door',exact:true}).click();
 await p.goBack();await p.waitForFunction(()=>location.hash==='#/fridge/notes'&&document.querySelector('.fridge-viewport').getAttribute('data-view')==='notes');
 await p.goForward();await p.waitForFunction(()=>location.hash==='#/fridge/goals'&&document.querySelector('.fridge-viewport').getAttribute('data-view')==='goals');
 await p.keyboard.press('Escape');await p.waitForFunction(()=>location.hash==='#/fridge'&&document.querySelector('.fridge-viewport').getAttribute('data-view')==='overview');
 await p.emulateMedia({reducedMotion:'reduce'});await p.getByRole('button',{name:'Open collage door',exact:true}).click();
 if(await p.locator('.fridge-viewport').getAttribute('data-view')!=='notes')throw Error('Reduced motion navigation');
 await settle();if(!await p.evaluate(()=>document.fonts.check('16px FridgeKalam')))throw Error('Local font unavailable');
 if(external.length)throw Error('Third-party requests detected');if(!fonts.some(url=>url.includes('/fridge/fonts/Kalam')))throw Error('Local handwriting was not requested');
 await context.close();
 const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const t=await touch.newPage();await t.goto(base+'#/fridge/notes');
 const photo=t.getByRole('button',{name:'A quiet afternoon',exact:true});await photo.scrollIntoViewIfNeeded();const b=await photo.boundingBox();if(b.width<44||b.height<44)throw Error('Touch target too small');
 const cdp=await touch.newCDPSession(t);const x=b.x+b.width/2,y=b.y+b.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let step=1;step<=5;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+step*4,y:y+step*3}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 if(await t.getByRole('dialog').count())throw Error('Touch drag activated object');
 if(!await t.evaluate(()=>JSON.parse(localStorage.getItem('fridge-layout:populated')??'{}')['sample-sofa']))throw Error('Touch drag not saved');
 await photo.tap();await t.getByRole('dialog').waitFor();await t.getByRole('button',{name:'Close',exact:true}).tap();
 if(await t.getByRole('dialog').count())throw Error('Touch close failed');await touch.close();
 console.log('PASS: 16 captures; real back/forward and Escape; opposite-door Tab exclusion; reduced motion; local Kalam loaded; zero external requests; real touch drag distinct from tap.');
}
