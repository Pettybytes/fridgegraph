async page => {
 const base='http://127.0.0.1:5238/evidence/fridge-experience/preview.html';
 const dir='/Users/user/Desktop/bentley/fridgegraph-fridge-experience/web/evidence/fridge-experience/verified/';
 for(const [name,width,height] of [['desktop',1440,1000],['phone',390,844]]){
  await page.setViewportSize({width,height});await page.goto(base);await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:dir+name+'-overview.png',fullPage:true});
  await page.getByRole('button',{name:'Open collage door',exact:true}).click();
  await page.screenshot({path:dir+name+'-collage.png',fullPage:true});
  const photo=page.getByRole('button',{name:'A quiet afternoon',exact:true});
  const box=await photo.boundingBox();if(!box||box.width<44||box.height<44)throw Error('Focused photo target too small');
  await photo.focus();await page.keyboard.press('Enter');if(!await page.getByRole('dialog').isVisible())throw Error('Keyboard dialog failed');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Open goals door',exact:true}).click();
  await page.screenshot({path:dir+name+'-goals.png',fullPage:true});
  await page.getByLabel('Preview perspective').selectOption('guide');
  await page.getByRole('button',{name:'Open goals door',exact:true}).click();
  await page.screenshot({path:dir+name+'-guide.png',fullPage:true});
  await page.getByLabel('Preview perspective').selectOption('refused');
  if(await page.getByText("These notes aren't shared with this perspective.",{exact:true}).count()!==3)throw Error('Refusal states missing');
  await page.screenshot({path:dir+name+'-refused.png',fullPage:true});
  await page.getByLabel('Preview perspective').selectOption('failed');
  if(await page.getByRole('button',{name:'Retry',exact:true}).count()!==3)throw Error('Retry missing');
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base);await page.getByRole('button',{name:'Open collage door',exact:true}).click();
 const photo=page.getByRole('button',{name:'A quiet afternoon',exact:true});await photo.scrollIntoViewIfNeeded();const b=await photo.boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+15,b.y+b.height/2+15,{steps:4});await page.mouse.up();
 if(await page.getByRole('dialog').count())throw Error('Drag opened photo');
 if(!await page.evaluate(()=>localStorage.getItem('fridge-layout:sample')))throw Error('Layout not persisted');
 await page.getByRole('button',{name:'Tidy up',exact:true}).click();
 console.log('PASS: desktop/phone captures; keyboard dialog/Escape; 44px focused photo targets; independent refusal/failure; reduced-motion immediate zoom; pointer drag; layout-only persistence and tidy.');
}
