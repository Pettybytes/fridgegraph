async page=>{
 const origin='http://127.0.0.1:'+new URL(page.url()).searchParams.get('harnessPort')
 page.on('response',async response=>{if(new URL(response.url()).pathname!=='/api/demo/login')return;try{const body=await response.json();if(body.status==='READY')await page.evaluate(async({origin,value})=>{await fetch(origin+'/hold',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})})},{origin,value:body.session.access_token})}catch{}})
 const progress=async stage=>page.evaluate(async({origin,stage})=>{await fetch(origin+'/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage})})},{origin,stage})
 await progress('Isolation Kendra')
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click();await page.getByText('Exploring as Kendra',{exact:true}).waitFor()
 await page.getByRole('heading',{name:'Recorded activity',exact:true}).waitFor({timeout:20000})
 await page.getByLabel('Message Rosina').fill('Who is authorized to pick up Nora today?');await page.getByRole('button',{name:'Send',exact:true}).click();await page.locator('.rosina-message:not(.from-person)>p').last().waitFor({timeout:45000})
 await page.getByRole('link',{name:'Family Calendar',exact:true}).click();await page.getByLabel('Calendar date',{exact:true}).fill('2026-11-25');await page.getByRole('button',{name:'Approved arrangement: scheduled with Andre',exact:true}).first().waitFor({timeout:20000})
 await page.evaluate(()=>{
  const audit={active:false,frames:0,leaks:0};window.__privateFrameAudit=audit
  const inspect=()=>{if(audit.active){const text=[...document.querySelectorAll('.family-calendar,.mcv,.rosina-thread,.village-route')].map(e=>e.textContent).join(' ');if(/Nora|Tasha|Monique|Loretta/.test(text))audit.leaks++}}
  document.addEventListener('click',event=>{if(event.target instanceof Element&&event.target.closest('button')?.textContent==='Switch perspective'){audit.active=true;const frame=()=>{inspect();audit.frames++;if(audit.frames<120)requestAnimationFrame(frame)};requestAnimationFrame(frame)}},{capture:true})
 })
 await page.getByRole('button',{name:'Switch perspective',exact:true}).click()
 if(await page.locator('.family-calendar,.rosina-message,.mcv-job').count())throw Error('Private session DOM survived leaving')
 await page.getByRole('button',{name:'Explore as Dana',exact:true}).click();await page.getByText('Exploring as Dana',{exact:true}).waitFor({timeout:20000})
 await progress('Isolation Dana calendar');await page.getByRole('link',{name:'Family Calendar',exact:true}).click()
 await page.getByRole('region',{name:'Family Calendar',exact:true}).waitFor({timeout:20000})
 if(await page.locator('.rosina-message').count())throw Error('Previous Rosina thread survived switching')
 await page.getByRole('link',{name:'Mission Control',exact:true}).click();await page.getByText('No recorded pickup run',{exact:true}).waitFor({timeout:20000})
 await page.getByRole('link',{name:'Living Village',exact:true}).click();await page.getByText('Sample data',{exact:true}).first().waitFor()
 await page.waitForFunction(()=>window.__privateFrameAudit.frames>=120)
 const audit=await page.evaluate(()=>window.__privateFrameAudit)
 if(audit.leaks)throw Error('Private records survived a perspective-switch frame')
 await progress('Isolation Guide capture')
 await page.getByRole('button',{name:'Switch perspective',exact:true}).click();await page.getByRole('button',{name:'Explore as the Demo guide',exact:true}).click();await page.getByText('Exploring as Demo guide',{exact:true}).waitFor({timeout:20000})
 await page.getByRole('link',{name:'Mission Control',exact:true}).click();await page.getByRole('heading',{name:'Recorded activity',exact:true}).waitFor({timeout:20000})
 for(const [size,label] of [[{width:1920,height:1080},'desktop'],[{width:390,height:844},'mobile']]){await page.setViewportSize(size);if((await page.locator('body').innerText()).includes(String.fromCharCode(101,121,74)))throw Error('Unsafe screenshot content');await page.screenshot({path:'web/evidence/demo-login/current/guide-read-only-'+label+'.png'})}
 const proof={passed:true,scope:'Actual picker Kendra to Dana: calendar, Rosina, Mission Control and sample Village; no previous private content between perspectives',frameAudit:{frames:audit.frames,leaks:audit.leaks}}
 await page.evaluate(async({origin,proof})=>{await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)})},{origin,proof})
 return proof
}
