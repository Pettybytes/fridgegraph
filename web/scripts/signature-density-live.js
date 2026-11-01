async launcher=>{
 const url=new URL(launcher.url()),origin='http://127.0.0.1:'+url.searchParams.get('harnessPort'),run=url.searchParams.get('run'),root='web/evidence/signature/'+run+'/',deadline=Date.parse(url.searchParams.get('until'))-2*60*1000;
 const checks=[],screenshots=[],contexts=[],requests=[];let stage='Not started',failure=null,identity=null;
 const post=(path,body)=>launcher.evaluate(async({origin,path,body})=>{await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})},{origin,path,body});
 const demand=(pass,check)=>{checks.push({check,pass:!!pass});if(!pass)throw Error('Assertion')};
 const progress=async value=>{demand(Date.now()<deadline,'Within reservation: '+value);stage=value;await post('/progress',{stage})};
 try{
  await progress('Real picker');const context=await launcher.context().browser().newContext({viewport:{width:1440,height:900}});contexts.push(context);const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('response',async response=>{try{if(new URL(response.url()).pathname==='/api/demo/login'){const body=await response.json();if(body.status==='READY'){await post('/hold',{token:body.session.access_token});identity={persona:body.personaId,childName:body.scope.childName}}}}catch{}});
  page.on('request',request=>{if(new URL(request.url()).pathname==='/graphql'){try{const body=request.postDataJSON();requests.push({mutation:/^\s*mutation\b/.test(body.query??'')})}catch{}}});
  await page.goto('http://127.0.0.1:5189/?focus#/today');await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click();await page.locator('.fg-today').waitFor();await page.locator('.orbit-notice').waitFor();demand(identity?.persona==='kendra','Actual picker issued Kendra session');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:900});await progress('Dark check-in '+width);await page.evaluate(()=>{location.hash='#/today';document.documentElement.classList.add('dark')});await page.locator('.orbit-notice').waitFor();await page.locator('.orbit-notice').scrollIntoViewIfNeeded();
   const contrast=await page.locator('.orbit-notice').evaluate(el=>{
    const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const bg=lum(rgb(getComputedStyle(el).backgroundColor));return [...el.querySelectorAll('h2,p,a')].map(e=>{const fg=lum(rgb(getComputedStyle(e).color));return (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)});
   });demand(contrast.length>0&&contrast.every(c=>c>=4.5),'Dark check-in contrast >=4.5: '+width);
   let path=root+width+'-dark-check-in.png';await page.screenshot({path});screenshots.push(path);
   await page.evaluate(()=>{location.hash='#/village'});await page.locator('.sg-full .sg-person').first().waitFor();
   for(const theme of ['light','dark']){
    await progress('Authorized dense Village '+width+' '+theme);await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);await page.waitForTimeout(700);
    const geometry=await page.evaluate(()=>{const boxes=[...document.querySelectorAll('.sg-person-name,.sg-relationship,.sg-child figcaption,.sg-person .sg-portrait,.sg-child .sg-portrait')].map(el=>el.getBoundingClientRect());let collisions=0;for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)collisions++}return {collisions,overflow:document.documentElement.scrollWidth>innerWidth}});
    demand(!geometry.collisions&&!geometry.overflow,'Live label and portrait bounds do not intersect: '+width+' '+theme);demand(await page.getByText('Sample data',{exact:true}).count()===0,'Live Village has no sample label');
    const reachable=new Set(await page.locator('.sg-person-name').allTextContents());
    for(const button of await page.locator('.sg-overflow').all()){await button.focus();await page.keyboard.press('Enter');for(const name of await page.locator('.sg-overflow-panel strong').allTextContents())reachable.add(name);await page.keyboard.press('Escape')}
    await page.getByRole('button',{name:'List view',exact:true}).click();const all=await page.locator('.sg-list strong').allTextContents();demand(all.length===reachable.size&&all.every(n=>reachable.has(n)),'All authorized identities reachable through overflow: '+width+' '+theme);await page.getByRole('button',{name:'Network view',exact:true}).click();await page.waitForTimeout(700);
    path=root+width+'-'+theme+'-village.png';await page.screenshot({path,fullPage:true});screenshots.push(path);
   }
   await page.locator('.sg-person button').first().click();await page.locator('.sg-detail').scrollIntoViewIfNeeded();path=root+width+'-person-detail.png';await page.screenshot({path});screenshots.push(path);
  }
  demand(requests.every(r=>!r.mutation),'No graph mutations or alerts opened');await progress('Complete');
 }catch(e){failure={kind:e.name,action:e.message?.match(/(?:page|locator).[A-Za-z]+:/)?.[0]??'assertion',timedOut:/timeout|timed out/i.test(e.message??'')};}
 finally{for(const context of contexts)await context.close();await post('/proof',{passed:!failure,stage,failure,checks,screenshots,backend:url.searchParams.get('backend'),uiHead:url.searchParams.get('head'),port:5189,mutationCount:requests.filter(r=>r.mutation).length,recording:'Screenshots only; no trace, HAR, video, storage state or header logging; real picker session'})}
 return {passed:!failure,stage};
}
