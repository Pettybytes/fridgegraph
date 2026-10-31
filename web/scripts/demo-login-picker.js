async page=>{
 const origin='http://127.0.0.1:'+new URL(page.url()).searchParams.get('harnessPort'),root='web/evidence/demo-login/current/',rows=[];let last
 page.on('response',async response=>{if(new URL(response.url()).pathname!=='/api/demo/login')return;try{const body=await response.json();if(body.status==='READY'){last={id:body.personaId};await page.evaluate(async({origin,value})=>{await fetch(origin+'/hold',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})})},{origin,value:body.session.access_token})}}catch{}})
 async function shots(name){for(const [size,label] of [[{width:1920,height:1080},'desktop'],[{width:390,height:844},'mobile']]){await page.setViewportSize(size);if((await page.locator('body').innerText()).includes(String.fromCharCode(101,121,74)))throw Error('Unsafe screenshot');await page.screenshot({path:root+name+'-'+label+'.png'})}await page.setViewportSize({width:1920,height:1080})}
 const people=[['kendra','Kendra'],['andre','Andre'],['loretta','Loretta'],['priya','Priya'],['dana','Dana'],['jax-family',"Jax's family"],['demo-guide','the Demo guide'],['rosa','Rosa Castellano'],['felicia','Felicia Reyes'],['simone','Simone Lee'],['dwayne','Dwayne Ferris']]
 for(const [,name] of people)if(!await page.getByRole('button',{name:'Explore as '+name,exact:true}).isEnabled())throw Error('Seeded perspective disabled')
 await shots('picker')
 for(const [id,name] of people){
  await page.evaluate(async({origin,id})=>{await fetch(origin+'/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage:'Picker '+id})})},{origin,id})
  await page.getByRole('button',{name:'Explore as '+name,exact:true}).click();await page.getByText('Exploring as '+(id==='demo-guide'?'Demo guide':name),{exact:true}).waitFor({timeout:20000});if(last?.id!==id)throw Error('Picker identity mismatch')
  await page.locator('.workspace main').waitFor();await page.waitForFunction(()=>!document.querySelector('main [role="status"]'),{},{timeout:20000})
  await shots(id+'-landing');rows.push({persona:id,picker:'READY'})
  await page.getByRole('button',{name:'Switch perspective',exact:true}).click()
 }
 const proof={passed:rows.length===11,scope:'Actual all-eleven READY picker paths and landing captures; UNAVAILABLE covered by controlled unit responses',rows}
 await page.evaluate(async({origin,proof})=>{await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)})},{origin,proof});return {passed:proof.passed,personas:rows.length}
}
