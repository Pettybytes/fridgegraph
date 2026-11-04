import {test,expect} from '@playwright/test'
const parents=['Kendra','Andre','Dana',"Jax's family",'Rosa Castellano','Felicia Reyes','Simone Lee','Dwayne Ferris']
for(const name of parents)test(`${name} sees each authorized child's live map`,async({page})=>{
 const worlds=new Map<string,any>()
 page.on('response',async response=>{if(response.url().endsWith('/graphql')&&response.request().postData()?.includes('WebMapVillageWorld')){const childId=response.request().postDataJSON()?.variables?.childId;// A child switch can cancel an earlier read before its body is available.
  const body=await response.json().catch(()=>null);if(body)worlds.set(childId,body)}})
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto('/')
 await page.getByRole('button',{name:`Explore as ${name}`,exact:true}).click()
 await expect(page.getByRole('button',{name:'Leave perspective',exact:true})).toBeVisible()
 await page.evaluate(()=>{location.hash='/village'})
 const selector=page.locator('main').getByRole('combobox',{name:'Viewing',exact:true})
 await expect(selector.locator('option').first()).toBeAttached()
 const children=await selector.locator('option').evaluateAll(options=>options.map(option=>({id:(option as HTMLOptionElement).value,name:option.textContent!})))
 expect(children.length).toBeGreaterThan(0)
 for(const child of children){
  await page.evaluate(()=>{location.hash='/village'})
  await selector.selectOption(child.id)
  await page.evaluate(()=>{location.hash='/map'})
  await expect.poll(()=>worlds.has(child.id)).toBe(true)
  const body=worlds.get(child.id)
  expect(body.errors).toBeUndefined()
  expect(body.data.villageWorld.child.id).toBe(child.id)
  expect(body.data.villageWorld.people.length).toBeGreaterThan(0)
  expect(body.data.villageWorld.people.every((row:any)=>row.homePlaceId)).toBe(true)
  expect(body.data.villageWorld.places.length).toBeGreaterThan(0)
  const map=page.getByRole('region',{name:'Village map',exact:true})
  await expect(map).toHaveAttribute('data-state','live')
  if(test.info().project.name==='mobile')expect((await map.locator('.vm-header').boundingBox())!.y).toBeLessThan(220)
  await expect(map).not.toContainText(/isn't shared|Couldn't load|Sample data/)
  const people=body.data.villageWorld.people.map((row:{person:{id:string}})=>row.person.id)
  if(['p_jax','p_malik','p_emma','p_taylor','p_skye','p_micah','p_avery'].includes(child.id))expect(people).not.toContain('p_mom')
  // Dana is a recorded friend-parent in Nora's village. Dwayne has no Ellison relationship.
  if(['p_nora','p_max','p_leo'].includes(child.id))expect(people).not.toContain('p_dwayne')
  if(child.id==='p_malik')expect(people).not.toContain('p_dana')
  if(child===children[0]){
   if(test.info().project.name==='mobile')await map.getByRole('button',{name:'expanded planner',exact:true}).click()
   await map.locator('summary').filter({hasText:'Route from'}).click()
   if(test.info().project.name==='desktop'){
    const pin=map.getByTestId(/^map-person-drag-/).first(),destinationPin=map.getByTestId(/^map-place-drop-/).first();
    await pin.dragTo(destinationPin);await expect(map.getByRole('region',{name:'Route estimate',exact:true})).toBeVisible()
   }
   await map.getByRole('combobox',{name:'From',exact:true}).selectOption(people[0])
   const destination=body.data.villageWorld.places.find((p:any)=>p.kind!=='HOME'&&p.coordinateState==='SET')
   await map.getByRole('combobox',{name:'To',exact:true}).selectOption(destination.id)
   await map.getByRole('button',{name:'Estimate route',exact:true}).click()
   const route=map.getByRole('region',{name:'Route estimate',exact:true})
   await expect(route).toContainText('fictional showcase route')
   for(const mode of ['Walk','Bike','Drive']){
    await map.getByRole('button',{name:mode,exact:true}).click()
    await expect(route.locator('strong')).toContainText(/min/)
    await expect(route).toContainText(/mi/)
   }
  }
  console.info(`${name}: ${child.id}: ${people.length} members, ${body.data.villageWorld.places.length} places`)
 }
 expect(errors).toEqual([])
})
test('Priya keeps Malik selected when opening the map from Living Village',async({page})=>{
 const childIds:string[]=[]
 page.on('request',request=>{if(request.url().endsWith('/graphql')&&request.postData()?.includes('WebMapVillageWorld'))childIds.push(request.postDataJSON().variables.childId)})
 await page.goto('/')
 await page.getByRole('button',{name:'Explore as Priya',exact:true}).click()
 await page.evaluate(()=>{location.hash='/village'})
 await page.getByRole('combobox',{name:'Viewing',exact:true}).selectOption('p_malik')
 await expect(page.getByRole('heading',{name:'A village around Malik Ferris.',exact:true})).toBeVisible()
 await page.evaluate(()=>{location.hash='/map'})
 await expect(page.locator('.topbar-context')).toHaveText("Malik Ferris's village")
 const map=page.getByRole('region',{name:'Village map',exact:true})
 await expect(map).toHaveAttribute('data-state','live')
 await expect(map).not.toContainText(/Couldn't load|isn't shared|refused/)
 await expect.poll(()=>childIds.at(-1)).toBe('p_malik')
 await map.getByRole('button',{name:'People',exact:true}).click()
 await expect(map.locator('.vm-person-row')).toHaveCount(1)
 await expect(map.locator('.vm-person-row')).toContainText('Priya')
})
