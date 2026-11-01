async page => {
 await page.getByRole('button',{name:'People',exact:true}).click();
 await page.locator('.vm-person-row').filter({hasText:'Loretta Brooks'}).click();
 if(await page.locator('.vm-person-marker.is-selected,.vm-cluster.is-selected').count()!==1)throw Error('Selection did not reach marker');
 await page.getByRole('button',{name:'Ask Rosina about the map'}).click();
 if(!await page.locator('.vm-rosina-context').innerText().then(t=>t.includes('Loretta')))throw Error('Selection did not reach Rosina');
 await page.getByRole('button',{name:'Show on map',exact:true}).click();
 const box=await page.locator('.vm-canvas').boundingBox();
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.35);await page.mouse.down();await page.mouse.move(box.x+box.width*.5+100,box.y+box.height*.35+60,{steps:15});await page.mouse.up();
 await page.getByRole('button',{name:'Follow route',exact:true}).waitFor();
 await page.getByLabel('Route preview progress').focus();await page.keyboard.press('Home');for(let i=0;i<35;i++)await page.keyboard.press('ArrowRight');
 await page.waitForTimeout(700);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Close Ask Rosina',exact:true}).click();
 await page.getByRole('button',{name:'expanded planner',exact:true}).click();await page.waitForTimeout(500);
 await page.getByRole('button',{name:'Days',exact:true}).click();await page.getByRole('button',{name:'Fri 6',exact:true}).click();
 await page.getByRole('button',{name:'half planner',exact:true}).click();await page.waitForTimeout(500);
 await page.getByRole('button',{name:'collapsed planner',exact:true}).click();await page.getByRole('button',{name:'Recenter map',exact:true}).click();await page.waitForTimeout(700);
 await page.getByRole('button',{name:'Ask Rosina about the map'}).click();await page.getByRole('button',{name:'Show on map',exact:true}).click();
 if(await page.getByRole('region',{name:'Ask Rosina',exact:true}).isVisible())throw Error('Mobile drawer obscures map after Show on map');
 await page.getByLabel('Route preview progress').focus();await page.keyboard.press('End');
 await page.getByRole('status').filter({hasText:'Arrived near school'}).waitFor();await page.waitForTimeout(900);
 return {selection:'panel + marker + Rosina',manualPan:'follow stopped',sheet:'all three positions',scrub:'arrival is not completion'};
}
