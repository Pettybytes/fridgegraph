import {expect,it} from 'vitest'
import source from '@/lib/frontendData/mock-data.json'
import {contactBadge,recordedEvents,lanesAt,recommendationFacts,formatRecordedTime} from './model'
it('replays only source events in timestamp order, without synthetic ringing or policy events',()=>{
 expect(recordedEvents.map(e=>e.id)).toEqual(['mc_0001','mc_0002','mc_0003','mc_0005','mc_0004','mc_0006'])
 for(const e of recordedEvents)expect(e.at).toBe(source.missionControl.events.find(s=>s.id===e.id)?.at)
 expect(recordedEvents.map(e=>e.title).join(' ')).not.toMatch(/ringing|policy check|approval recorded/i)
})
it('keeps parallel lanes unknown until recorded outreach and evaluates each independently',()=>{
 expect(lanesAt(0).every(c=>c.state==='Not contacted yet'&&!c.attempt)).toBe(true)
 expect(lanesAt(1).every(c=>c.state==='Waiting for reply'&&c.attempt?.at==='2026-10-28T14:58:16Z')).toBe(true)
 const states=lanesAt(3)
 expect(states.find(c=>c.id==='p_monique')?.state).toBe('No answer')
 expect(states.find(c=>c.id==='p_bryan')?.state).toBe('Waiting for reply')
 expect(lanesAt(5).find(c=>c.id==='p_bryan')?.state).toBe('Declined')
 expect(lanesAt(5).find(c=>c.id==='p_tasha')?.state).toBe('Available')
})
it('keeps three contact modes distinct and does not infer a missing mode',()=>{
 expect(contactBadge('REAL_CONSENTED')).toBe('Real call (consented)')
 expect(contactBadge('TEST_RESPONDER')).toBe('Test responder')
 expect(contactBadge('SIMULATED')).toBe('Simulated')
 expect(contactBadge(null)).toBe('Contact mode not recorded')
})
it('explains recommendation from authorization, human response, transport evidence and distance',()=>{
 expect(recommendationFacts()).toEqual({authorized:true,available:true,hasTransport:true,distance:4.5})
})

it('shows original seconds in US Detroit time, with a zone when DST makes it necessary',()=>{
 expect(formatRecordedTime('2026-10-28T14:58:16Z')).toBe('10:58:16 AM')
 expect(formatRecordedTime('2026-11-01T05:15:00Z')).toBe('1:15:00 AM EDT')
 expect(formatRecordedTime('2026-11-01T06:15:00Z')).toBe('1:15:00 AM EST')
})
