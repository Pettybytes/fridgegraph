import {expect,it} from 'vitest'
import {ActivityLedger} from './activityLedger'
import {orderedPeople,relationshipGroup,ringSlots,concentricLayout} from './layout'
it('groups descriptive relationships without translating them into permission',()=>{expect(relationshipGroup('grandmother')).toBe('Family');expect(relationshipGroup('sitter')).toBe('Care');expect(relationshipGroup('teacher')).toBe('School & activities');expect(relationshipGroup('not_recorded')).toBe('Connections')})
it('keeps the network geometry stable and sorts without response or authority ranking',()=>{const people=[{id:'b',name:'Zoe',relationship:'parent',group:'Family',authorityLabel:'can approve'},{id:'a',name:'Ana',relationship:'sitter',group:'Care'}];expect(orderedPeople(people).map(p=>p.id)).toEqual(['a','b']);expect(ringSlots(5)).toEqual(ringSlots(5));expect(ringSlots(0)).toEqual([])})
it('baseline responses never animate and each newly recorded response is observed once',()=>{const ledger=new ActivityLedger();expect(ledger.observe(['old'])).toEqual([]);expect(ledger.observe(['old','new'])).toEqual(['new']);expect(ledger.observe(['old','new'])).toEqual([]);expect(ledger.observe(['old'])).toEqual([]);expect(ledger.observe(['old','new'])).toEqual([]);ledger.clear();expect(ledger.observe(['new'])).toEqual([])})
it('retains every authorized person in dense category rings or accessible overflow',()=>{
 const people=Array.from({length:30},(_,i)=>({id:String(i),name:`Long authorized name ${i}`,relationship:'recorded connection',group:i<10?'Household':i<20?'Family':'Care'}))
 for(const narrow of [false,true]){
  const layout=concentricLayout(people,narrow)
  const reachable=[...layout.nodes.map(n=>n.person.id),...layout.rings.flatMap(r=>r.overflow.map(p=>p.id))]
  expect(new Set(reachable).size).toBe(30);expect(reachable).toHaveLength(30)
 }
})
