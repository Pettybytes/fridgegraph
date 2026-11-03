async page=>{
 const check=(v,m)=>{if(!v)throw Error(m)}
 await page.setViewportSize({width:390,height:844})
 await page.goto('http://127.0.0.1:5243/evidence/fridge-editing-integration/preview.html#/fridge');await page.reload()
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
 const viewer=page.getByRole('region',{name:'Fridge viewer'})
 await viewer.waitFor();await viewer.evaluate(e=>e.scrollIntoView({block:'start'}))
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Phone horizontal overflow')
 const box=await viewer.boundingBox()
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.resetPageScaleFactor');await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2})
 const t=(x,y,id)=>({x,y,id,radiusX:2,radiusY:2,force:1})
 const controls=await page.getByRole('navigation',{name:'Fridge view controls'}).boundingBox()
 const x=box.x+box.width/2,y=Math.min(box.y+box.height-60,Math.max(box.y+220,controls.y+controls.height+80))
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[t(x-35,y,1),t(x+35,y,2)]})
 for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[t(x-35-i*10,y,1),t(x+35+i*10,y,2)]})
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
 const scale=Number(await viewer.getAttribute('data-scale'))
 check(scale>1,'Actual touch pinch failed')
 check(await page.evaluate(()=>visualViewport.scale===1),'Pinch must not zoom the browser page')
 await page.screenshot({path:'/tmp/fridgeux-pinch.png'})

 await page.getByRole('button',{name:'Reset view',exact:true}).click()
 await viewer.evaluate(e=>e.scrollIntoView({block:'start'}))
 const scroll=()=>viewer.evaluate(el=>{let n=0;for(let p=el.parentElement;p;p=p.parentElement)n+=p.scrollTop;return n})
 const before=await scroll(),touchBox=await viewer.boundingBox(),startY=Math.min(touchBox.y+touchBox.height-30,370)
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[t(195,startY,1)]})
 for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[t(195,startY-i*20,1)]});await page.waitForTimeout(20)}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
 await page.waitForTimeout(200)
 check(await scroll()>before,'Overview single-finger page scroll')
 await cdp.detach()
 return {scale,horizontalOverflow:false,overviewTouchScroll:true}
}
