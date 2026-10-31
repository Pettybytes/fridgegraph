async page=>{
 const origin='http://127.0.0.1:'+new URL(page.url()).searchParams.get('harnessPort')
 const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/demo/login'&&r.request().method()==='POST'&&r.request().postData()?.includes('kendra'))
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
 const response=await responsePromise,body=await response.json()
 const allowed=['MINT_LINK_FAILED','MINT_VERIFY_FAILED','MINT_IDENTITY_MISMATCH','MINT_MARKER_MISSING','MINT_REFRESH_FAILED','DEMO_LOGIN_UNAVAILABLE','UNKNOWN_PERSONA','NO_SEEDED_IDENTITY']
 const reason=body.status==='READY'?'READY':response.status()===429?'RATE_LIMITED':allowed.includes(body.reason)?body.reason:'UNCLASSIFIED'
 if(body.status==='READY')await page.evaluate(async({origin,value})=>{await fetch(origin+'/hold',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})})},{origin,value:body.session.access_token})
 const proof={passed:body.status==='READY'&&response.status()===200,httpStatus:response.status(),reason,servingCheckout:'/Users/user/Desktop/bentley/fridgegraph',port:4008}
 await page.evaluate(async({origin,proof})=>{await fetch(origin+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)})},{origin,proof})
 return {httpStatus:proof.httpStatus,reason:proof.reason,servingCheckout:proof.servingCheckout,port:proof.port}
}
