async page=>{
 const origin='http://127.0.0.1:'+new URL(page.url()).searchParams.get('harnessPort'),root='web/evidence/demo-login/current/',rows=[]
 page.on('response',async response=>{if(new URL(response.url()).pathname!=='/api/demo/login')return;try{const body=await response.json();if(body.status==='READY')await page.evaluate(async({origin,value})=>{await fetch(origin+'/hold',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})})},{origin,value:body.session.access_token})}catch{}})
 const progress=async stage=>page.evaluate(async({origin,stage})=>{await fetch(origin+'/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage})})},{origin,stage})
 const sequence=[['kendra','Kendra'],['andre','Andre'],['loretta','Loretta'],['priya','Priya'],['dana','Dana'],['jax-family',"Jax's family"],['demo-guide','the Demo guide']]
 for(const [id,name] of sequence){
  await progress('Rosina capture '+id)
  const sw=page.getByRole('button',{name:'Switch perspective',exact:true});if(await sw.isVisible())await sw.click()
  await page.getByRole('button',{name:'Explore as '+name,exact:true}).click();await page.getByText('Exploring as '+(id==='demo-guide'?'Demo guide':name),{exact:true}).waitFor({timeout:20000})
  await page.getByRole('link',{name:'Mission Control',exact:true}).click()
  const question=['loretta','priya'].includes(id)?'Can Nora have a peanut-butter snack?':`Who is authorized to pick up ${['dana','jax-family'].includes(id)?'Jax':'Nora'} today? Distinguish authorization from availability. Do not include contact details.`
  await page.getByLabel('Message Rosina').fill(question);await page.getByRole('button',{name:'Send',exact:true}).click();const replyNode=page.locator('.rosina-message:not(.from-person)>p').last();await replyNode.waitFor({timeout:45000});const reply=await replyNode.innerText()
  for(const [size,label] of [[{width:1920,height:1080},'desktop'],[{width:390,height:844},'mobile']]){
   await page.setViewportSize(size)
   if(label==='mobile'){await page.getByRole('button',{name:'Ask Rosina',exact:true}).click();await page.getByRole('region',{name:'Ask Rosina',exact:true}).waitFor()}
   await replyNode.scrollIntoViewIfNeeded()
   if((await page.locator('body').innerText()).includes(String.fromCharCode(101,121,74)))throw Error('Unsafe screenshot content')
   await page.screenshot({path:root+id+'-rosina-'+label+'.png'})
   if(label==='mobile')await page.getByRole('button',{name:'Close Ask Rosina',exact:true}).click()
  }
  rows.push({persona:id,question,reply})
  await page.setViewportSize({width:1920,height:1080})
 }
 const proof={passed:true,scope:'Refreshed desktop and mobile Rosina evidence; full acceptance receipt remains results.json',rows}
 await page.evaluate(async({origin,proof})=>{await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)})},{origin,proof})
 return {passed:true,personas:rows.length}
}
