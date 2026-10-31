async page=>{
 const origin='http://127.0.0.1:'+new URL(page.url()).searchParams.get('harnessPort'),root='web/evidence/demo-login/current/',rows=[],calendarRosina=[]
 let currentSession
 page.on('response',async response=>{if(new URL(response.url()).pathname!=='/api/demo/login')return;try{const body=await response.json();if(body.status==='READY'){currentSession=body;await page.evaluate(async({origin,value})=>{await fetch(origin+'/hold',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})})},{origin,value:body.session.access_token})}}catch{}})
 const progress=async stage=>page.evaluate(async({origin,stage})=>{await fetch(origin+'/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage})})},{origin,stage})
 const blocked=await page.evaluate(async()=>{const m=await import('/src/features/rosina/catalog.ts');return !m.catalog.prepareOrbitAlert.implemented&&m.validateActions([{id:'prepareOrbitAlert',args:{childId:'p_nora',wearColor:'blue'},implemented:true,requiresConfirmation:false}]).length===0})
 if(!blocked)throw Error('Unimplemented Orbit preparation became usable')
 async function graph(query,variables){return await page.evaluate(async({token,query,variables})=>{const response=await fetch('/graphql',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({query,variables})});const body=await response.json();return {ok:response.ok&&!body.errors?.length,data:body.data}},{token:currentSession.session.access_token,query,variables})}
 async function followup(message){const launch=page.getByRole('button',{name:'Ask Rosina',exact:true});if(await launch.isVisible())await launch.click();const count=await page.locator('.rosina-message:not(.from-person)>p').count();await page.getByLabel('Message Rosina').fill(message);await page.getByRole('button',{name:'Send',exact:true}).click();const node=page.locator('.rosina-message:not(.from-person)>p').nth(count);await node.waitFor({timeout:45000});return await node.innerText()}
 const onlyPersona=new URL(page.url()).searchParams.get('onlyPersona')
 const sequence=[['kendra','Kendra'],['andre','Andre'],['loretta','Loretta'],['priya','Priya'],['dana','Dana'],['jax-family',"Jax's family"],['demo-guide','the Demo guide']]
 for(const [id,name] of sequence.filter(([id])=>!onlyPersona||id===onlyPersona)){
  await progress('Rosina capture '+id)
  const sw=page.getByRole('button',{name:'Switch perspective',exact:true});if(await sw.isVisible())await sw.click()
  await page.getByRole('button',{name:'Explore as '+name,exact:true}).click();await page.getByText('Exploring as '+(id==='demo-guide'?'Demo guide':name),{exact:true}).waitFor({timeout:20000})
  if(currentSession?.persona.id!==id)throw Error('Perspective response identity mismatch')
  await page.getByRole('link',{name:'Mission Control',exact:true}).click()
  const question=['loretta','priya'].includes(id)?'Can Nora have a peanut-butter snack?':`Who is authorized to pick up ${['dana','jax-family'].includes(id)?'Jax':'Nora'} today? Distinguish authorization from availability. Do not include contact details.`
  await page.getByLabel('Message Rosina').fill(question);await page.getByRole('button',{name:'Send',exact:true}).click();const replyNode=page.locator('.rosina-message:not(.from-person)>p').last();await replyNode.waitFor({timeout:45000});const reply=await replyNode.innerText()
  let actualCandidates=[]
  if(['loretta','priya'].includes(id)){if(!/can't confirm|cannot confirm|not connected/i.test(reply))throw Error(id+': unsupported-care refusal missing')}
  else{
   const tool=await graph('query CurrentPickup($childId:ID!){pickupCandidates(childId:$childId){person{id displayName} authorization availability}}',{childId:currentSession.scope.childId})
   if(!tool.ok)throw Error(id+': authorized pickup read unavailable')
   actualCandidates=tool.data.pickupCandidates
   const words=new Set([...new Intl.Segmenter('en',{granularity:'word'}).segment(reply)].map(x=>x.segment.toLowerCase()))
   if(!actualCandidates.every(c=>words.has(c.person.displayName.split(' ')[0].toLowerCase()))||/couldn't check|send your question again|busy, try again|give me a moment/i.test(reply))throw Error(id+': live reply not grounded in current candidates')
   await page.evaluate(async({origin,proof})=>{await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)})},{origin,proof:{passed:false,incomplete:true,rows,active:{persona:id,question,reply,actualCandidates}}})
   if(actualCandidates.some(c=>c.availability==='UNKNOWN')&&!/unknown|not recorded|not confirmed|can't confirm/i.test(reply))throw Error(id+': unknown availability distinction missing')
  }
  for(const [size,label] of [[{width:1920,height:1080},'desktop'],[{width:390,height:844},'mobile']]){
   await page.setViewportSize(size)
   if(label==='mobile'){await page.getByRole('button',{name:'Ask Rosina',exact:true}).click();await page.getByRole('region',{name:'Ask Rosina',exact:true}).waitFor()}
   await replyNode.scrollIntoViewIfNeeded()
   if((await page.locator('body').innerText()).includes(String.fromCharCode(101,121,74)))throw Error('Unsafe screenshot content')
   await page.screenshot({path:root+id+'-rosina-'+label+'.png'})
   if(label==='mobile')await page.getByRole('button',{name:'Close Ask Rosina',exact:true}).click()
  }
  rows.push({persona:id,question,reply,result:['loretta','priya'].includes(id)?'correct refusal':'live answer',actualCandidates})
  await page.setViewportSize({width:1920,height:1080})
  if(id==='kendra'){
   const actual=await graph('query CurrentSchedule($childId:ID!,$date:String!){effectiveScheduleFor(childId:$childId,date:$date){parent{id displayName} source arrangementId}}',{childId:currentSession.scope.childId,date:'2026-11-26'})
   const message='Who is scheduled with Nora on November 26, 2026? Is this the weekly schedule or an approved arrangement?',answer=await followup(message),care=actual.data?.effectiveScheduleFor
   if(!actual.ok||!care?.parent||!answer.includes(care.parent.displayName.split(' ')[0])||(care.source==='ARRANGEMENT'&&!/arrangement/i.test(answer)))throw Error('Rosina calendar differs from current schedule read')
   calendarRosina.push({persona:id,question:message,reply:answer,actual:care})
  }
  if(id==='dana'){const message="Show me Nora's calendar on November 26, 2026.",answer=await followup(message);if(answer!=="I can only help with children shared with you.")throw Error('Dana private-calendar refusal differs');calendarRosina.push({persona:id,question:message,reply:answer})}
 }
 const newPersonas=[]
 if(!onlyPersona){
  await page.getByRole('button',{name:'Switch perspective',exact:true}).click()
  for(const name of ['Kendra','Andre','Loretta','Priya','Dana',"Jax's family",'the Demo guide','Rosa Castellano','Felicia Reyes','Simone Lee','Dwayne Ferris'])if(!await page.getByRole('button',{name:'Explore as '+name,exact:true}).isEnabled())throw Error('Seeded perspective incorrectly disabled')
  for(const [size,label] of [[{width:1920,height:1080},'desktop'],[{width:390,height:844},'mobile']]){await page.setViewportSize(size);await page.screenshot({path:root+'picker-'+label+'.png'})}await page.setViewportSize({width:1920,height:1080})
  for(const [id,name] of [['rosa','Rosa Castellano'],['felicia','Felicia Reyes'],['simone','Simone Lee'],['dwayne','Dwayne Ferris']]){
   await progress('Seeded picker '+id);await page.getByRole('button',{name:'Explore as '+name,exact:true}).click();await page.getByText('Exploring as '+name,{exact:true}).waitFor({timeout:20000});if(currentSession?.persona.id!==id)throw Error('Seeded perspective identity mismatch')
   for(const [size,label] of [[{width:1920,height:1080},'desktop'],[{width:390,height:844},'mobile']]){await page.setViewportSize(size);if((await page.locator('body').innerText()).includes(String.fromCharCode(101,121,74)))throw Error('Unsafe screenshot');await page.screenshot({path:root+id+'-landing-'+label+'.png'})}await page.setViewportSize({width:1920,height:1080})
   newPersonas.push({persona:id,picker:'READY',liveReads:'pending expanded Cast v2 integration',rosina:'pending expanded Cast v2 integration'});await page.getByRole('button',{name:'Switch perspective',exact:true}).click()
  }
 }
 const proof={passed:true,scope:'Affected #38 current-main Rosina/catalog acceptance; unchanged graph/isolation full receipt remains results.json',catalogUnimplemented:blocked,rows,calendarRosina,newPersonas}
 await page.evaluate(async({origin,proof})=>{await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)})},{origin,proof})
 return {passed:true,personas:rows.length}
}
