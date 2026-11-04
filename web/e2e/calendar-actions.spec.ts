import {test,expect,type Page} from '@playwright/test'
async function enter(page:Page,name:string){await page.goto('/');await page.getByRole('button',{name:name==='Demo guide'?'Explore as the Demo guide':`Explore as ${name}`,exact:true}).click()}
async function ask(page:Page,text:string){await page.getByRole('textbox',{name:'Message Rosina'}).fill(text);await page.getByRole('button',{name:'Send',exact:true}).click()}
for(const name of ['Kendra','Demo guide'])test(`${name} confirms calendar add, move and cancel three times`,async({page,context})=>{
 const batch=String(Date.now());
 const viewer=await context.newPage();await enter(viewer,'Andre');await viewer.getByRole('link',{name:'Activity',exact:true}).click();
 await enter(page,name);await page.getByRole('link',{name:'Ask Rosina',exact:true}).click();
 for(const suffix of ['alpha','beta','gamma']){
  const title=`birthday party ${name.toLowerCase()} ${batch} ${suffix}`;
  const begun=Date.now();await ask(page,`book a ${title} for Nora Ellison at 9pm tomorrow at Family home`);
  const card=page.getByRole('region',{name:'Confirm calendar change'}).last();
  await expect(card.getByRole('button',{name:'Add to calendar',exact:true})).toBeVisible();
  const proposed=Date.now()-begun;expect(proposed).toBeLessThan(3000);
  await expect(card).toContainText('9:00 PM');await expect(card).toContainText('10:00 PM');await expect(card).toContainText('Family home');
  await expect(viewer.locator('main')).not.toContainText(title);
  const confirmed=Date.now();await card.getByRole('button',{name:'Add to calendar',exact:true}).click();await expect(page.getByText(`Done: added ${title}`,{exact:false})).toBeVisible();
  await expect(viewer.getByRole('region',{name:'Calendar changes'})).toContainText(`added ${title}`);const propagated=Date.now()-confirmed;expect(propagated).toBeLessThan(2000);
  await ask(page,'move it to 7pm');await expect(page.getByRole('button',{name:'Confirm move',exact:true})).toBeVisible();await ask(page,'yes');await expect(page.getByText(`Done: moved ${title}`,{exact:false})).toBeVisible();
  await expect(viewer.getByRole('region',{name:'Calendar changes'})).toContainText(`updated ${title}`);
  await page.getByRole('button',{name:'Close Ask Rosina',exact:true}).click();await page.getByRole('link',{name:'Family Calendar',exact:true}).click();await expect(page.locator('main')).toContainText(title);
  await page.getByRole('link',{name:'Mission Control',exact:true}).click();await expect(page.getByRole('region',{name:'Calendar changes'})).toContainText(title);
  await page.getByRole('link',{name:'Ask Rosina',exact:true}).click();await expect(page.getByRole('button',{name:'Confirm move',exact:true})).toHaveCount(0);
  await ask(page,'cancel it');await page.getByRole('button',{name:'Cancel event',exact:true}).click();await expect(page.getByText(`Done: cancelled ${title}`,{exact:false})).toBeVisible();
  await expect(viewer.getByRole('region',{name:'Calendar changes'})).toContainText(`cancelled ${title}`);
  console.info(JSON.stringify({perspective:name,run:suffix,proposalMs:proposed,writeAndAndreActivityMs:propagated}));
 }
 // A reload now restores Andre's perspective in this tab (refresh-keeps-perspective): no re-pick is offered or needed.
 await viewer.reload();await expect(viewer.getByRole('button',{name:'Leave perspective',exact:true})).toBeVisible();await expect(viewer.getByRole('button',{name:'Explore as Andre',exact:true})).toHaveCount(0);await viewer.getByRole('link',{name:'Activity',exact:true}).click();await expect(viewer.getByRole('region',{name:'Calendar changes'})).toContainText(`cancelled birthday party ${name.toLowerCase()} ${batch} gamma`);
 await viewer.getByRole('button',{name:'Leave perspective',exact:true}).click();await viewer.getByRole('button',{name:'Explore as Dana',exact:true}).click();await viewer.getByRole('link',{name:'Activity',exact:true}).click();await expect(viewer.locator('main')).not.toContainText(`birthday party ${name.toLowerCase()}`);
 await viewer.close();
});
