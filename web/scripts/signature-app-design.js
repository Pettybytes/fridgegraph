async page=>{
 const fixture=await page.evaluate(async()=>{const module=await import('/scripts/signature-fixture-data.ts');return module.villageFixture.data.villageGraph})
 const person=id=>fixture.nodes.find(node=>node.person.id===id)?.person
 await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'CONTROLLED_UI_ONLY'})}))
 await page.route('**/graphql',route=>{
  const body=route.request().postDataJSON(),op=body.operationName
  const childId=body.variables?.childId??'p_nora',data={}
  if(op==='WebMyChildren')data.myChildren=['p_nora','p_leo'].map(id=>({child:{id,person:person(id)},scopes:['schedule.read']}))
  else if(op==='WebSignatureVillage'){data.child={person:person(childId)};data.householdMembers=fixture.nodes.filter(node=>node.household).map(node=>({person:node.person,role:node.role}));data.relationships=fixture.edges.filter(edge=>person(edge.from.id)).map(edge=>({id:edge.relationship.id,from:person(edge.from.id),to:{id:edge.to.id},type:edge.relationship.type,status:edge.relationship.status}))}
  else if(op==='WebCoordinationJobs')data.coordinationJobs=[]
  else if(op==='WebOrbitStatus')data.orbitStatus={alertId:null,status:null,audienceCount:0,notifiedCount:0,latestResponses:[],guidance:'If there is an emergency, call 911.'}
  else if(op==='WebOrbitCheck')data.checkInStatus={recorded:true,label:'Check-in',text:'Check-in recorded',dueAt:null,guidance:'If there is an emergency, call 911.'}
  else if(op==='WebOrbitVocabulary')data.orbitVocabulary=[]
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data})})
 })
 await page.goto('http://127.0.0.1:5189/scripts/signature-app-design.html')
 await page.getByRole('button',{name:'Explore as Kendra',exact:true}).click()
 await page.getByRole('link',{name:'Today',exact:true}).click()
 await page.locator('.sg-compact .sg-child').waitFor()
 return {mode:'Controlled fixture; all API/graph requests intercepted; actual App/Today/Signature components'}
}
