async page=>{
 const origin='http://127.0.0.1:'+new URL(page.url()).searchParams.get('harnessPort')
 page.on('response',async response=>{if(new URL(response.url()).pathname!=='/api/demo/login')return;try{const body=await response.json();if(body.status==='READY')await page.evaluate(async({origin,value})=>{await fetch(origin+'/hold',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})})},{origin,value:body.session.access_token})}catch{}})
 await page.getByRole('button',{name:'Explore as Loretta',exact:true}).click();await page.getByText('Exploring as Loretta',{exact:true}).waitFor({timeout:20000})
 const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/rosina',{timeout:45000})
 await page.getByLabel('Message Rosina').fill('Can Nora have a peanut-butter snack?');await page.getByRole('button',{name:'Send',exact:true}).click()
 const response=await responsePromise,body=await response.json()
 const status=response.status(),reason=status===200?'OK':['UNAUTHENTICATED','RATE_LIMITED','INVALID_REQUEST'].includes(body.error)?body.error:'UNCLASSIFIED'
 let rendered=false;try{await page.locator('.rosina-message:not(.from-person)>p').last().waitFor({timeout:40000});rendered=true}catch{}
 const proof={passed:status===200&&body.reply==="I can't confirm that yet."&&rendered,httpStatus:status,reason,careRefusal:body.reply==="I can't confirm that yet.",rendered,checking:await page.getByText('Rosina is checking…',{exact:true}).isVisible(),picker:await page.getByRole('button',{name:'Explore as Loretta',exact:true}).isVisible()}
 await page.evaluate(async({origin,proof})=>{await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)})},{origin,proof})
 return proof
}
