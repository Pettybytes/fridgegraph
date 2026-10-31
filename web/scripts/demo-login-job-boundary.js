async page=>{
 const origin='http://127.0.0.1:'+new URL(page.url()).searchParams.get('harnessPort'),held=new Map(),rows=[],errors=[]
 page.on('response',async response=>{if(new URL(response.url()).pathname!=='/api/demo/login'||response.status()!==200)return;try{const body=await response.json();if(body.status==='READY'){held.set(body.personaId,body.session.access_token);await page.evaluate(async({origin,value})=>{await fetch(origin+'/hold',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})})},{origin,value:body.session.access_token})}}catch{}})
 let jobId=null,baseline
 for(const [id,name] of [['kendra','Kendra'],['andre','Andre'],['loretta','Loretta'],['priya','Priya'],['dana','Dana'],['jax-family',"Jax's family"],['demo-guide','the Demo guide']]){
  const sw=page.getByRole('button',{name:'Switch perspective',exact:true});if(await sw.isVisible())await sw.click()
  await page.getByRole('button',{name:'Explore as '+name,exact:true}).click();await page.getByText('Exploring as '+(id==='demo-guide'?'Demo guide':name),{exact:true}).waitFor({timeout:20000})
  for(let i=0;i<50&&!held.has(id);i++)await page.waitForTimeout(20)
  const inspect=jobId=>page.evaluate(async({token,jobId})=>(await import('/scripts/demo-login-probes.ts')).inspectStoredJob(token,jobId),{token:held.get(id),jobId})
  if(!jobId){jobId=(await inspect(null)).ids[0];if(!jobId)throw Error('No stored job available; direct job boundary remains pending')}
  const result=await inspect(jobId),allowed=['kendra','andre','demo-guide'].includes(id)
  if(id==='kendra')baseline=result
  const pass=allowed?result.ids.includes(jobId)&&result.timelineCount===baseline.timelineCount&&result.attemptCount===baseline.attemptCount&&result.timelineCount>0&&result.attemptCount>0:result.ids.length===0&&result.timelineCount===0&&result.attemptCount===0
  if(!pass)errors.push(id+': direct stored-job boundary failed')
  rows.push({persona:id,pass,expectation:allowed?'same persisted sandbox records':'empty, no existence disclosure',...result})
 }
 const proof={passed:errors.length===0,scope:'Direct known stored-job boundary only; does not override the six directory-name failures',rows,errors}
 await page.evaluate(async({origin,proof})=>{await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)})},{origin,proof})
 return {passed:proof.passed,personas:rows.length,errors}
}
