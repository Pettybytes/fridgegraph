async page=>{
 const origin='http://127.0.0.1:'+new URL(page.url()).searchParams.get('harnessPort'),base='http://127.0.0.1:5185/',root='web/evidence/demo-login/current/'
 const rosinaHttp=new Map(),calendarRosina=[],rows=[],sessions=new Map(),loginOutcomes=new Map(),errors=[],directoryReads=[]
 const demand=(ok,label)=>{if(!ok)errors.push(label)}
 const progress=async stage=>page.evaluate(async({origin,stage})=>{await fetch(origin+'/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage})})},{origin,stage})
 function watch(p){p.on('response',async response=>{const path=new URL(response.url()).pathname;if(path==='/api/rosina'){try{const body=await response.json();rosinaHttp.set(p,{status:response.status(),nonemptyReply:typeof body.reply==='string'&&body.reply.trim().length>0})}catch{rosinaHttp.set(p,{status:response.status(),nonemptyReply:false})}return}if(path!=='/api/demo/login')return;try{const body=await response.json(),id=body.personaId;const reasons=['MINT_LINK_FAILED','MINT_VERIFY_FAILED','MINT_IDENTITY_MISMATCH','MINT_MARKER_MISSING','MINT_REFRESH_FAILED','DEMO_LOGIN_UNAVAILABLE','UNKNOWN_PERSONA','NO_SEEDED_IDENTITY'];loginOutcomes.set(id,{http:response.status(),status:body.status==='READY'?'READY':'UNAVAILABLE',reason:reasons.includes(body.reason)?body.reason:response.status()===429?'RATE_LIMITED':'unknown'});if(body.status==='READY'){sessions.set(p,{persona:body.persona,token:body.session.access_token});await p.evaluate(async({origin,value})=>{await fetch(origin+'/hold',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})})},{origin,value:body.session.access_token})}}catch{}})}watch(page)
 async function shot(p,name){if((await p.locator('body').innerText()).includes(String.fromCharCode(101,121,74)))throw Error('Unsafe screenshot content');await p.screenshot({path:root+name+'.png'})}
 async function pair(p,name,scroll){for(const [size,label] of [[{width:1920,height:1080},'desktop'],[{width:390,height:844},'mobile']]){await p.setViewportSize(size);if(name.endsWith('-rosina')&&label==='mobile'){const launch=p.getByRole('button',{name:'Ask Rosina',exact:true});if(await launch.isVisible())await launch.click();await p.getByRole('region',{name:'Ask Rosina',exact:true}).waitFor()}if(scroll)await scroll(p,label);await shot(p,name+'-'+label);if(name.endsWith('-rosina')&&label==='mobile')await p.getByRole('button',{name:'Close Ask Rosina',exact:true}).click()}await p.setViewportSize({width:1920,height:1080})}
 async function choose(p,id,name){
  await progress('Choose '+id);const sw=p.getByRole('button',{name:'Switch perspective',exact:true});if(await sw.isVisible())await sw.click()
  await p.getByRole('button',{name:'Explore as '+name,exact:true}).click()
  const chip=p.getByText('Exploring as '+(id==='demo-guide'?'Demo guide':name),{exact:true})
  try{await Promise.race([chip.waitFor({timeout:20000}),p.getByRole('alert').first().waitFor({timeout:20000})])}catch{}
  if(!await chip.isVisible())return false
  for(let i=0;i<50&&sessions.get(p)?.persona.id!==id;i++)await p.waitForTimeout(20)
  demand(sessions.get(p)?.persona.id===id,id+': mismatched response identity');return sessions.get(p)?.persona.id===id
 }
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='Explore as Rosa Castellano'&&b.disabled));await pair(page,'picker')
 const initialReady=await choose(page,'kendra','Kendra');let contextResult='pending: Kendra login unavailable'
 if(initialReady){const first=sessions.get(page).token,contextB=await page.context().browser().newContext({viewport:{width:1440,height:1000}}),b=await contextB.newPage();watch(b);await b.goto(base);const danaReady=await choose(b,'dana','Dana');if(danaReady&&await choose(b,'andre','Andre')){const same=await page.getByText('Exploring as Kendra',{exact:true}).isVisible()&&sessions.get(page).token===first;demand(same,'Context B changed context A identity');contextResult=same?'pass':'failed'}else contextResult='pending: second context login unavailable';await contextB.close()}
 let parentJob
 const sequence=[['kendra','Kendra'],['andre','Andre'],['loretta','Loretta'],['priya','Priya'],['dana','Dana'],['jax-family',"Jax's family"],['demo-guide','the Demo guide']]
 for(const [id,name] of sequence){
  const ready=id==='kendra'?initialReady:await choose(page,id,name)
  if(!ready){demand(await page.getByText('Busy, try again in a moment',{exact:true}).first().isVisible(),id+': retryable Busy state missing');demand(await page.getByRole('button',{name:'Explore as '+name,exact:true}).isEnabled(),id+': temporary failure disabled persona');demand(!await page.locator('.session-chip').count(),id+': another perspective was substituted');await pair(page,id+'-login-unavailable');rows.push({persona:id,picker:'failed',login:loginOutcomes.get(id)??{status:'unknown'},liveReads:'pending: no session',rosina:{result:'pending'}});continue}
  const held=sessions.get(page),other=held.persona.childId==='p_nora'?'p_jax':'p_nora',guide=id==='demo-guide'
  await progress('Read '+id)
  const result=await page.evaluate(async({token,childId,other,personId})=>{const m=await import('/scripts/demo-login-probes.ts');return {legacy:await m.inspect(token,childId,other),calendar:await m.inspectGroup3(token,childId,guideOther(other),personId)};function guideOther(id){return id}},{token:held.token,childId:held.persona.childId,other:guide?'fx_audit_child':other,personId:held.persona.personId})
  const {legacy,calendar}=result
  if(legacy.foreign.data?.child)directoryReads.push(id)
  demand(legacy.foreign.ok&&!!legacy.foreign.data?.child?.person?.id,id+': documented directory read unavailable')
  demand(guide||legacy.foreignHousehold.refused,id+': foreign household not refused');demand(guide||legacy.foreignPickup.refused,id+': foreign candidates not refused')
  demand(calendar.own.outcome==='ready',id+': selected calendar unavailable')
  demand(calendar.boundaries.every(row=>row.events.outcome==='refused'&&row.care.outcome==='refused'&&row.conflicts.outcome==='refused'),id+': calendar operation boundary mismatch')
  demand(JSON.stringify(calendar.boundaries[0])===JSON.stringify(calendar.boundaries[1])&&JSON.stringify(calendar.boundaries[1])===JSON.stringify(calendar.boundaries[2]),id+': hidden/nonexistent/malformed child outcomes differ')
  demand(calendar.unavailableAdults.every(row=>row.outcome==='ready'&&row.data?.adultAvailability?.length===0),id+': adult hidden/nonexistent/malformed must be the same empty read')
  demand(!JSON.stringify(calendar.adults).includes('reason'),id+': availability contains private reason')
  const job=legacy.jobs.data?.coordinationJobs?.[0]
  if(id==='kendra'){parentJob=job?.id;demand(!!job,'Kendra sample job missing: check shared HANDOFF/restoration first')}
  if(id==='andre')demand(job?.id===parentJob,'Andre and Kendra see different stored jobs')
  await page.evaluate(async({origin,partial})=>{await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(partial)})},{origin,partial:{passed:false,incomplete:true,rows,active:{persona:id,legacy,calendar},errors}})
  await pair(page,id+'-landing')
  await page.getByRole('link',{name:'Mission Control',exact:true}).click();await page.locator('.mcv-job,.mcv-empty,.persona-access-state,.mcv [role="alert"]').first().waitFor({timeout:20000})
  if(job){demand(await page.getByText('Sample activity',{exact:true}).isVisible(),id+': simulated activity label missing');demand(legacy.runs[0].timeline.data?.jobTimeline.length===5,id+': stored timeline differs')}
  if(id==='kendra')await pair(page,'mission-control-timeline',async p=>p.getByRole('heading',{name:'Recorded activity',exact:true}).scrollIntoViewIfNeeded())
  // A test-only explicit confirm click exercises the real guide write refusal; no product bypass.
  if(guide){await page.evaluate(token=>{const button=document.createElement('button');button.textContent='Confirm read-only refusal probe';button.id='guide-refusal-probe';button.onclick=async()=>{const m=await import('/scripts/demo-login-probes.ts');const p=document.createElement('p');p.id='guide-refusal-result';p.textContent=await m.confirmGuideRefusal(token);button.after(p)};document.querySelector('main').prepend(button)},held.token);await page.getByRole('button',{name:'Confirm read-only refusal probe'}).click();await page.locator('#guide-refusal-result').waitFor();demand(await page.locator('#guide-refusal-result').innerText()==='Demo guide is read-only','Guide forced-write refusal missing');await page.locator('#guide-refusal-probe').evaluate(e=>e.remove());await pair(page,'guide-read-only');await page.locator('#guide-refusal-result').evaluate(e=>e.remove())}
  await progress('Calendar UI '+id);await page.getByRole('link',{name:'Family Calendar',exact:true}).click();await page.getByRole('region',{name:'Family Calendar',exact:true}).waitFor({timeout:20000})
  await progress('Calendar date '+id);await page.getByLabel('Calendar date',{exact:true}).fill('2026-11-25');await page.getByRole('region',{name:'Wednesday, Nov 25 day'}).waitFor({timeout:20000})
  if(held.persona.childId==='p_nora'){
   for(const date of ['2026-11-25','2026-11-26','2026-11-27']){const actual=calendar.daily.find(x=>x.date===date);demand(actual.outcome==='ready'&&actual.data?.effectiveScheduleFor?.source==='ARRANGEMENT'&&actual.data.effectiveScheduleFor.parent?.id==='p_dad',id+': arrangement boundary differs on '+date)}
   demand(calendar.daily.find(x=>x.date==='2026-11-28')?.data?.effectiveScheduleFor?.source==='WEEKLY',id+': Nov 28 did not return to weekly')
   await progress('Care band '+id);await page.getByRole('button',{name:'Approved arrangement: scheduled with Andre',exact:true}).first().waitFor({timeout:20000});demand(await page.getByText('Weekly schedule',{exact:true}).count()>0,id+': weekly source missing')
  }
  await pair(page,id+'-calendar',async(p,label)=>{if(label==='mobile')await p.getByRole('region',{name:'Wednesday, Nov 25 day'}).scrollIntoViewIfNeeded()})
  if(id==='kendra'||id==='andre'){
   await page.getByLabel('Calendar date',{exact:true}).fill('2026-11-21');await page.getByRole('region',{name:'Saturday, Nov 21 day'}).waitFor()
   demand(!await page.getByRole('button',{name:/Recital \(cancelled\)/}).count(),id+': cancelled event visible by default')
   await page.getByRole('checkbox',{name:'Show cancelled events'}).check();await page.getByRole('button',{name:/Recital \(cancelled\)/}).waitFor({timeout:20000})
   demand(calendar.defaults.data?.childEvents?.every(e=>e.status!=='cancelled')&&calendar.cancelled.data?.childEvents?.some(e=>e.status==='cancelled'),id+': live cancelled filter not proven')
   if(id==='kendra')await pair(page,'calendar-cancelled',async p=>p.getByRole('button',{name:/Recital \(cancelled\)/}).scrollIntoViewIfNeeded())
  }
  // Exercise a forbidden child route under the same browser perspective. Guide uses the non-sandbox audit child.
  const hash=`#/calendar?day=2026-11-25&childId=${encodeURIComponent(guide?'fx_audit_child':other)}`;await page.evaluate(hash=>{location.hash=hash},hash)
  await page.getByRole('heading',{name:"This isn't shared with you",exact:true}).waitFor({timeout:20000});demand(!await page.getByText('Private appointment',{exact:true}).count(),id+': private event leaked')
  await page.getByRole('link',{name:'Mission Control',exact:true}).click()
  const launch=page.getByRole('button',{name:'Ask Rosina',exact:true});if(await launch.isVisible())await launch.click()
  const question=['loretta','priya'].includes(id)?'Can Nora have a peanut-butter snack?':`Who is authorized to pick up ${held.persona.childId==='p_jax'?'Jax':'Nora'} today? Distinguish authorization from availability. Do not include contact details.`
  await page.getByLabel('Message Rosina').fill(question);await page.getByRole('button',{name:'Send',exact:true}).click();const replyNode=page.locator('.rosina-message:not(.from-person)>p').last();try{await replyNode.waitFor({timeout:45000})}catch{const ui=await page.evaluate(()=>({messages:document.querySelectorAll('.rosina-message').length,panelHidden:document.querySelector('.rosina-panel')?.hidden===true,checking:document.querySelector('.rosina-thread')?.textContent?.includes('Rosina is checking')===true,picker:!!document.querySelector('.persona-picker'),sendDisabled:[...document.querySelectorAll('button')].some(b=>b.textContent==='Send'&&b.disabled)}));await page.evaluate(async({origin,proof})=>{await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)})},{origin,proof:{passed:false,incomplete:true,rows,errors,failedWait:{persona:id,http:rosinaHttp.get(page)??null,ui}}});await shot(page,id+'-reply-timeout');throw Error('Rosina reply did not become visible: '+id)}const reply=await replyNode.innerText()
  const candidates=legacy.pickup.data?.pickupCandidates??[];const words=new Set([...new Intl.Segmenter('en',{granularity:'word'}).segment(reply)].map(x=>x.segment.toLowerCase()));const grounded=candidates.length===0||candidates.every(c=>words.has(c.person.displayName.split(' ')[0].toLowerCase()));const live=!/couldn't check|give me a moment|sign in again|empty with an error|send your question again|busy, try again|session ended/i.test(reply)&&(['loretta','priya'].includes(id)||grounded);if(id==='kendra')demand(live,'Kendra live Rosina answer unavailable')
  if(['loretta','priya'].includes(id))demand(/can't confirm|cannot confirm|not connected/i.test(reply),id+': unsupported care answer')
  const forbidden=held.persona.childId==='p_jax'?['Nora','Loretta','Tasha']:guide?[]:['Jax','Evelyn'];demand(!forbidden.some(n=>new RegExp('\\b'+n+'\\b','i').test(reply)),id+': Rosina introduced a foreign identity')
  await pair(page,id+'-rosina')
  rows.push({persona:id,picker:'READY',liveReads:{legacy,calendar},rosina:{question,reply,result:live?(['loretta','priya'].includes(id)?'correct refusal':'live answer'):'pending'}})
  // #37 adds these live tools; check the merged service against the same recorded schedule.
  async function followup(message){const reopen=page.getByRole('button',{name:'Ask Rosina',exact:true});if(await reopen.isVisible())await reopen.click();const count=await page.locator('.rosina-message:not(.from-person)>p').count();await page.getByLabel('Message Rosina').fill(message);await page.getByRole('button',{name:'Send',exact:true}).click();const response=page.locator('.rosina-message:not(.from-person)>p').nth(count);await response.waitFor({timeout:45000});return await response.innerText()}
  if(id==='kendra'){
   const message='Who is scheduled with Nora on November 26, 2026? Is this the weekly schedule or an approved arrangement?',answer=await followup(message)
   demand(/Andre/.test(answer)&&/arrangement/i.test(answer),'Kendra Rosina schedule differs from the live Thanksgiving calendar')
   calendarRosina.push({persona:id,question:message,reply:answer,expected:'Live effectiveScheduleFor: ARRANGEMENT / p_dad on 2026-11-26'})
  }
  if(id==='dana'){
   const message="Show me Nora's calendar on November 26, 2026.",answer=await followup(message)
   demand(answer==="I can only help with children shared with you.",'Dana Rosina private-calendar boundary differs')
   calendarRosina.push({persona:id,question:message,reply:answer,expected:'Scoped refusal with no child or adult identities'})
  }

 }
 const proof={calendarRosina,passed:errors.length===0&&rows.every(row=>row.picker==='READY'),errors,directoryReads,directoryPolicy:'Bryan confirmed evidence 37: directory identities are readable; private records remain permission-gated',graphEndpoint:'4012, explicit local smoke override; default app proxy remains 4010',contexts:contextResult,rosa:'Coming soon, disabled; no substitute',rows,recording:'No trace/HAR/video/storage-state/header logging'}
 await page.evaluate(async({origin,proof})=>{const response=await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)});if(!response.ok)throw Error('Unsafe proof rejected')},{origin,proof})
 return {passed:proof.passed,personas:rows.length,errors}
}
