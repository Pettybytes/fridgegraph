import {test,expect} from '@playwright/test'

// Card 1 (guide served-build stack): Kendra stages the early-dismissal sample from
// Today, reviews Rosina's proposal inside the Ask Rosina panel, and confirms it BY
// MOUSE. The confirm must create a persisted pickup job whose id is shown, and the
// Today card must record that same job id. Regression for the panel overlap that
// pushed the draft (and its Review/Confirm controls) out of the panel over Today,
// where mouse clicks were intercepted and no job was ever created.
test('Kendra confirms the school notice by mouse and a job is persisted', async ({page})=>{
 await page.goto('/')
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
 await expect(page.getByRole('button',{name:'Leave perspective',exact:true})).toBeVisible()
 await page.evaluate(()=>{location.hash='/today'})
 await page.getByRole('button',{name:'Add the school notice',exact:true}).click()
 const confirm=page.getByRole('button',{name:'Confirm pickup request',exact:true})
 await expect(confirm).toBeVisible({timeout:60_000})
 await expect(confirm).toBeEnabled({timeout:60_000})
 // The whole point of the fix: a real mouse click lands on the button (no keyboard,
 // no DOM click), so Playwright's hit-target check must pass inside the panel.
 await confirm.click()
 await expect(page.getByText('Pickup request created',{exact:true})).toBeVisible({timeout:30_000})
 const jobText=await page.locator('.notice-confirmed').innerText()
 const jobId=jobText.match(/Job ID:\s*(\S+)/)?.[1]
 expect(jobId,'confirmed panel must show the persisted job id').toBeTruthy()
 // The Today judge card records the same job id from the server's response.
 await expect(page.locator('.demo-checklist__action-state')).toContainText(`Pickup request recorded`)
 await expect(page.locator('.demo-checklist__action-state')).toContainText(jobId!)
 // And the job is a real record: Mission Control lists pickup requests for review.
 await page.evaluate(()=>{location.hash='/mission-control'})
 await expect(page.locator('main')).toContainText(/Pickup/,{timeout:30_000})
})
