import {render,screen} from '@testing-library/react'
import {expect,it} from 'vitest'
import {AlertTakeover,lastSeenCopy} from './AlertTakeover'
import {OrbitController} from './controller'
import type {Alert,OrbitAdapter} from './adapter'
const guidance='If there is an emergency, call 911.'
const base:Alert={id:'alert',child:{id:'child'},status:'ACTIVE',message:'Exact shared message.',share:{photoId:null,wearColor:'blue'},activatedAt:'2026-11-01T20:00:00Z',closedAt:null,audience:[{person:{id:'recipient',displayName:'Recipient'},eligible:true}],responses:[],latestResponses:[],guidance,lastSeenPlace:{id:'place',kind:'PARK',label:'Recorded Park'},lastSeenAt:'2026-11-01T19:00:00Z'}
function fixture(record:Alert){
 const adapter:OrbitAdapter={check:async()=>({recorded:false,label:'check',text:'not recorded',dueAt:null,guidance}),vocabulary:async()=>[],places:async()=>[{id:'place',kind:'PARK',label:'Recorded Park'}],status:async()=>({alertId:record.id,status:record.status,audienceCount:1,notifiedCount:1,latestResponses:[],guidance}),alert:async()=>record,draft:async()=>({draftId:'d',draftVersion:1,status:'PENDING_ACTIVATION',guidance}),preview:async()=>({draftId:'d',draftVersion:1,message:'m',messageHash:'h',audienceSize:1,guidance}),activate:async()=>record,respond:async()=>{},close:async()=>record,upload:async()=>'photo',photo:async()=>new Blob()}
 return new OrbitController(adapter,{childId:'child',personId:'recipient',parent:false,readOnly:false,generation:1},()=>1)
}
it('a timestamp without recorded provenance is never presented as an observation',()=>{
 const unprovenanced=lastSeenCopy({...base,lastSeenProvenance:null})
 expect(unprovenanced.placeText).toBe('Recorded Park')
 expect(unprovenanced.timeText).toBeNull()
 const provenanced=lastSeenCopy({...base,lastSeenProvenance:'PARENT_ENTERED'})
 expect(provenanced.timeText).toMatch(/2:00 PM/)
 expect(provenanced.recorded).toBe(true)
 const none=lastSeenCopy({...base,lastSeenPlace:null,lastSeenAt:null,lastSeenProvenance:null})
 expect(none.missingText).toBe('Last-seen place and time not recorded.')
})
it('the active card records the parent source only when the payload carries one',async()=>{
 const unprovenanced=fixture({...base,lastSeenProvenance:null});await unprovenanced.load()
 const view=render(<AlertTakeover controller={unprovenanced} childName="Nora Ellison"/>)
 expect(screen.getByText('Recorded Park')).toBeVisible()
 expect(screen.getByText('Time not recorded.')).toBeVisible()
 expect(screen.queryByText(/recorded by a parent/i)).not.toBeInTheDocument()
 view.unmount()
 const provenanced=fixture({...base,lastSeenProvenance:'PARENT_ENTERED'});await provenanced.load()
 render(<AlertTakeover controller={provenanced} childName="Nora Ellison"/>)
 expect(screen.getByText(/recorded by a parent/i)).toBeVisible()
 expect(screen.queryByText('Time not recorded.')).not.toBeInTheDocument()
})
