import {expect,it} from 'vitest'
import {intersects,layoutLabels,type LabelAnchor} from './labelLayout'
import {unclutter} from './model'
it('keeps 390px zoomed-out labels away from badges, portraits and each other',()=>{
 const anchors:LabelAnchor[]=[{id:'park',x:270,y:310,text:'Riverside Park',priority:0},{id:'school',x:210,y:245,text:'A long authorized school label',priority:2},{id:'center',x:115,y:165,text:'Oakwood Community Center',priority:0}]
 const markers=anchors.map(a=>({x:a.x-32,y:a.y-32,width:64,height:64}))
 const labels=[...layoutLabels(anchors,markers,{x:8,y:80,width:374,height:420}).values()]
 expect(labels.length).toBeGreaterThan(0)
 for(const [i,a] of labels.entries()){expect(a.x).toBeGreaterThanOrEqual(8);expect(a.x+a.width).toBeLessThanOrEqual(382);for(const b of [...markers,...labels.slice(i+1)])expect(intersects(a,b)).toBe(false)}
})
it('omits only crowded captions, preserving every authorized member in the cluster',()=>{
 const points=[{id:'a',x:100},{id:'b',x:150},{id:'c',x:230}]
 const groups=unclutter(points,p=>[p.x,100],64)
 expect(groups.map(g=>g.map(p=>p.id))).toEqual([['a','b'],['c']])
 expect(layoutLabels([{id:'a',x:100,y:100,text:'Long name',priority:1}],[],{x:0,y:0,width:100,height:100}).size).toBe(0)
})
