async page=>{
 await page.route(/\/api\/|\/graphql(?:\?|$)/,r=>r.abort())
 await page.setViewportSize({width:1440,height:900})
 await page.goto('http://127.0.0.1:5244/evidence/fridge-editing-integration/preview.html#/today');await page.reload()
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
 await page.getByRole('link',{name:'The Fridge',exact:true}).waitFor()
 await page.getByRole('link',{name:'The Fridge',exact:true}).hover();await page.waitForTimeout(500)
 const times=await page.evaluate(async()=>{
  const ready=()=>document.querySelector('[aria-label="Recorded goals"]')?.textContent.includes('Read together after school')
  const one=async()=>{const start=performance.now();location.hash='#/fridge';while(!ready()){if(performance.now()-start>5000)throw Error('Route timeout');await new Promise(requestAnimationFrame)}return performance.now()-start}
  const cold=await one(),warm=[]
  for(let i=0;i<10;i++){location.hash='#/today';await new Promise(r=>setTimeout(r,50));warm.push(await one())}
  return {cold,warm}
 })
 return {conditions:'Local Vite, 1440x900, mounted App, memory mock adapters, no network throttling; 500ms module-only hover prefetch before first navigation; meaningful content = recorded goal DOM',...times,resources:await page.evaluate(()=>performance.getEntriesByType('resource').filter(e=>e.name.includes('/fridge/')||e.name.includes('/fridge.')).map(e=>({path:new URL(e.name).pathname,ms:e.duration,bytes:e.transferSize})))}
}
