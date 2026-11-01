async page => {
 const start=Date.now();
 await page.getByRole('button',{name:'Thu 5',exact:true}).click();
 await page.getByRole('button',{name:'People',exact:true}).click();
 await page.locator('.vm-person-row').filter({hasText:'Loretta Brooks'}).dragTo(page.locator('.vm-canvas [data-place-id=school]'));
 await page.getByRole('region',{name:'Route estimate'}).waitFor();
 await page.waitForTimeout(750);
 await page.getByRole('button',{name:'Walk',exact:true}).click();
 await page.waitForTimeout(700);
 await page.getByRole('button',{name:'Propose pickup',exact:true}).click();
 await page.getByRole('button',{name:'Review pickup proposal',exact:true}).click();
 const approve=page.getByRole('button',{name:'Approve sample proposal',exact:true});
 if(await approve.isEnabled())throw Error('Over-limit approval enabled without consent');
 await page.getByRole('checkbox').check();await approve.click();
 await page.getByRole('button',{name:'Close Ask Rosina',exact:true}).click();
 await page.getByRole('link',{name:'Back to Today',exact:true}).click();
 await page.getByRole('button',{name:'Expand simulated route preview',exact:true}).scrollIntoViewIfNeeded();
 await page.waitForTimeout(400);
 await page.getByRole('button',{name:'Expand simulated route preview',exact:true}).click();
 await page.getByRole('button',{name:'Play route preview',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Arrived near school'}).waitFor({timeout:16000});
 await page.waitForTimeout(Math.max(800,20000-(Date.now()-start)));
 return {elapsedMs:Date.now()-start,arrival:'simulation only; no completion recorded'};
}
