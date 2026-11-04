import {expect,test} from '@playwright/test'

// This restores the SHARED demo. Deliberately opt in, never run as an automatic read-only sweep.
test.skip(process.env.RESET_ALLOW_SHARED!=='1','Set RESET_ALLOW_SHARED=1 only for the coordinated reset rehearsal.')
test('one public reset commits under2s and keeps Kendra in the same perspective',async({page},info)=>{
 const statusRead=await page.request.get('/api/demo/reset/dc880956-a6db-413e-85dc-d912b3ebd76b')
 expect(statusRead.status(),'Public edge must route the protected run-status URL to auth, never the SPA').toBe(401)
 await page.goto('/#/mission-control')
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
 await expect(page.locator('.session-chip')).toContainText('Kendra',{timeout:20_000})
 await page.getByRole('button',{name:'Reset demo',exact:true}).click()
 const dialog=page.getByRole('alertdialog')
 await expect(dialog).toBeVisible()
 const confirm=dialog.getByRole('button',{name:'Reset demo for everyone',exact:true})
 await expect(confirm).toHaveCSS('background-color','rgb(0, 0, 0)')
 expect(await confirm.evaluate(e=>parseFloat(getComputedStyle(e).borderRadius))).toBeGreaterThan(100)
 await page.screenshot({path:info.outputPath('confirm-desktop.png')})
 await page.setViewportSize({width:390,height:844})
 expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
 await page.screenshot({path:info.outputPath('confirm-phone.png')})
 await page.setViewportSize({width:1440,height:900})
 const network:{path:string;status:number;responseMs:number}[]=[]
 page.on('response',response=>{
  const path=new URL(response.url()).pathname
  if(path==='/api/demo/reset'||path.startsWith('/api/demo/reset/'))network.push({path,status:response.status(),responseMs:response.request().timing().responseStart})
 })
 const route=page.url(),reply=page.waitForResponse(r=>r.url().endsWith('/api/demo/reset')&&r.request().method()==='POST').catch(()=>null)
 await confirm.evaluate(e=>{e.addEventListener('click',()=>{
  const proof={start:performance.now(),done:null as number|null};(window as unknown as {resetProof:typeof proof}).resetProof=proof
  const observer=new MutationObserver(()=>{const toast=document.querySelector('.reset-demo-toast');if(toast?.textContent==='Demo reset.'&&document.querySelector('.session-chip')?.textContent?.includes('Kendra')){proof.done=performance.now()-proof.start;observer.disconnect()}})
  observer.observe(document.body,{subtree:true,childList:true,characterData:true})
 },{capture:true,once:true})})
 await confirm.click()
 try{await expect(page.locator('.reset-demo-toast')).toHaveText('Demo reset.',{timeout:2000})}
 catch(error){
  // Preserve the strict failure, but observe bounded recovery before closing the browser.
  // Otherwise a pending response is discarded and neither its status nor final UI is captured.
  await page.waitForFunction(()=>!!document.querySelector('.reset-demo-toast,.reset-demo-error'),undefined,{timeout:8000}).catch(()=>{})
  const result=await page.evaluate(()=>({timing:(window as unknown as {resetProof:{done:number|null}}).resetProof,success:document.querySelector('.reset-demo-toast')?.textContent==='Demo reset.',samePersona:!!document.querySelector('.session-chip')?.textContent?.includes('Kendra'),uncertain:!!document.querySelector('.reset-demo-error')?.textContent?.includes("Couldn't confirm")}))
  console.log(`PUBLIC_RESET_DIAGNOSTIC=${JSON.stringify({network,...result})}`)
  throw error
 }
 const elapsed=await page.evaluate(()=>(window as unknown as {resetProof:{done:number|null}}).resetProof.done)
 expect(elapsed,'Native Confirm click to committed same-persona success must be under2000ms').not.toBeNull()
 expect(elapsed!).toBeLessThan(2000)
 const response=await reply
 expect(response,'The reset must receive its committed HTTP response').not.toBeNull()
 if(!response)throw Error('Reset response was not received')
 expect(response.status()).toBe(200)
 // Assert primitives only: failures must never print a real session/token payload.
 const body=await response.json()
 expect(body.status).toBe('committed');expect(typeof body.runId).toBe('string')
 expect(body.personaId).toBe('kendra')
 expect(body.session===null||typeof body.session?.access_token==='string').toBe(true)
 expect(body.session&&'refresh_token'in body.session).toBeFalsy()
 await expect(page.locator('.session-chip')).toContainText('Kendra')
 await expect(page.getByRole('alertdialog')).toHaveCount(0)
 expect(page.url()).toBe(route)
 expect(await page.getByRole('button',{name:'Explore as Kendra',exact:true}).count()).toBe(0)
 await page.screenshot({path:info.outputPath('same-perspective-success.png')})
 console.log(`PUBLIC_RESET_MS=${elapsed!.toFixed(1)}`)
 // Re-entry at phone size is a layout check, not a second shared restore.
 await page.setViewportSize({width:390,height:844})
 await expect(page.locator('.session-chip')).toContainText('Kendra')
 await page.getByRole('button',{name:'Reset demo',exact:true}).click()
 await expect(page.getByRole('alertdialog')).toBeVisible()
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
})
