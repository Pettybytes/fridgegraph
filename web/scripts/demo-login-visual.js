async page=>{
 const origin='http://127.0.0.1:'+new URL(page.url()).searchParams.get('harnessPort'),root='web/evidence/demo-login/'
 page.on('response',async response=>{if(new URL(response.url()).pathname!=='/api/demo/login'||response.status()!==200)return;try{const body=await response.json();if(body.status==='READY')await page.evaluate(async({origin,value})=>{await fetch(origin+'/hold',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})})},{origin,value:body.session.access_token})}catch{}})
 const shot=async name=>{if((await page.locator('body').innerText()).includes(String.fromCharCode(101,121,74)))throw Error('Unsafe screenshot');await page.screenshot({path:root+name+'.png'})}
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click();await page.getByText('Exploring as Kendra',{exact:true}).waitFor()
 await page.getByRole('heading',{name:'Recorded activity',exact:true}).waitFor()
 for(const [size,label] of [[{width:1920,height:1080},'desktop'],[{width:390,height:844},'mobile']]){
  await page.setViewportSize(size);await page.getByRole('heading',{name:'Recorded activity',exact:true}).scrollIntoViewIfNeeded();await shot('mission-control-timeline-'+label)
 }
 await page.evaluate(()=>{
  const audit={active:false,leaks:0,frames:0};window.__perspectiveAudit=audit
  document.addEventListener('click',()=>{audit.active=true},{capture:true,once:true})
  function inspect(){if(audit.active){audit.frames++;const visible=document.querySelector('.mcv')?.textContent??'';if(/Tasha|Monique|Nora/.test(visible))audit.leaks++}if(audit.frames<120)requestAnimationFrame(inspect)}requestAnimationFrame(inspect)
 })
 await page.getByRole('button',{name:'Switch perspective',exact:true}).click();await page.getByRole('button',{name:'Explore as Dana',exact:true}).click();await page.getByText('Exploring as Dana',{exact:true}).waitFor()
 await page.getByText('No recorded pickup run',{exact:true}).waitFor();await page.waitForTimeout(120)
 const audit=await page.evaluate(()=>window.__perspectiveAudit)
 if(audit.leaks||!audit.frames)throw Error('Private pickup data survived a perspective switch frame')
 await page.getByRole('button',{name:'Switch perspective',exact:true}).click();await page.getByRole('button',{name:'Explore as the Demo guide',exact:true}).click();await page.getByText('Exploring as Demo guide',{exact:true}).waitFor()
 await page.locator('.village-route > .persona-mock').waitFor()
 for(const [size,label] of [[{width:1440,height:1000},'desktop'],[{width:390,height:844},'mobile']]){await page.setViewportSize(size);await shot('demo-guide-landing-'+label)}
 const proof={passed:true,scope:'Additional visual and frame-isolation checks only; does not override the failing full directory gate',frameAudit:{pass:true,frames:audit.frames,leaks:audit.leaks},screenshots:['mission-control-timeline-desktop.png','mission-control-timeline-mobile.png']}
 await page.evaluate(async({origin,proof})=>{await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)})},{origin,proof})
 return proof
}
