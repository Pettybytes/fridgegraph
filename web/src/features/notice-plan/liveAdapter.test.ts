import {expect,it,vi} from 'vitest'
import {createLiveNoticeAdapter} from './liveAdapter'
import type {NoticeProposal} from './types'

const proposal:NoticeProposal={
 proposalId:'np_test',version:2,childId:'p_nora',
 scenario:{referenceDate:'2026-10-26',timezone:'America/Detroit'},
 source:{processingSource:'text',modelId:'test-model'},
 createdAt:'2026-10-26T13:00:00-04:00',expiresAt:'2026-10-26T13:15:00-04:00',
 changes:[{what:'Early dismissal',source:{type:'verified_quote',quote:'School closes early.',startOffset:0,endOffset:20},whyItMatters:'Recorded pickup is later.',whoAffected:'Nora',unknown:[],onConfirm:{action:'requestPickup',params:{asOf:'2026-10-26',window:'afternoon'}}}],
 clarification:null,
 claims:{proposalId:'np_test',version:2,callerId:'p_mom',childId:'p_nora',scenarioDate:'2026-10-26',action:'requestPickup',params:{asOf:'2026-10-26',window:'afternoon'},scheduleFingerprint:'test-only-fingerprint',expiresAt:'2026-10-26T13:15:00-04:00'},
 signature:'test-only-signature',
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})

it('reads the current bearer for each request and sends the merged handler’s exact confirm body',async()=>{
 let bearer='test-only-session-a'
 const send=vi.fn<typeof fetch>().mockResolvedValueOnce(json(proposal)).mockResolvedValueOnce(json({job:{id:'job-one',status:'discovering'}}))
 const adapter=createLiveNoticeAdapter(()=>bearer,send)
 const request={childId:'p_nora',notice:{kind:'text' as const,text:'School closes early.'}}
 expect(await adapter.prepare(request,new AbortController().signal)).toEqual(proposal)
 bearer='test-only-session-b'
 expect(await adapter.confirm(proposal,new AbortController().signal)).toEqual({job:{id:'job-one',status:'discovering'}})
 expect(send).toHaveBeenCalledTimes(2)
 expect(send.mock.calls[0][0]).toBe('/api/rosina/notice-plan')
 expect(send.mock.calls[0][1]?.headers).toEqual({'Content-Type':'application/json',Authorization:'Bearer test-only-session-a'})
 expect(JSON.parse(String(send.mock.calls[0][1]?.body))).toEqual(request)
 expect(send.mock.calls[1][0]).toBe('/api/rosina/notice-plan/confirm')
 expect(send.mock.calls[1][1]?.headers).toEqual({'Content-Type':'application/json',Authorization:'Bearer test-only-session-b'})
 expect(JSON.parse(String(send.mock.calls[1][1]?.body))).toEqual({claims:proposal.claims,signature:proposal.signature})
})

it('keeps a clarification resume in the same request as its original notice, per merged parseNotice',async()=>{
 const send=vi.fn<typeof fetch>().mockResolvedValue(json({...proposal,version:3,claims:{...proposal.claims,version:3}}))
 const adapter=createLiveNoticeAdapter(()=> 'test-only-session',send)
 const request={childId:'p_nora',notice:{kind:'text' as const,text:'School closes early.'},resume:{proposalId:'np_test',version:2,answer:'October 26'}}
 await adapter.prepare(request,new AbortController().signal)
 expect(JSON.parse(String(send.mock.calls[0][1]?.body))).toEqual(request)
})

it.each([
 [401,'UNAUTHENTICATED'],[403,'UNAUTHORIZED'],[400,'INVALID_PROPOSAL'],
 [410,'PROPOSAL_EXPIRED'],[409,'PROPOSAL_STALE'],[422,'NO_ACTION_AVAILABLE'],
 [429,'RATE_LIMITED'],[502,'PICKUP_FAILED'],
] as const)('confirm HTTP %i maps %s without retrying or exposing raw server text',async(status,code)=>{
 const send=vi.fn<typeof fetch>().mockResolvedValue(json({error:code,detail:'internal test-only detail'},status))
 const adapter=createLiveNoticeAdapter(()=> 'test-only-session',send)
 await expect(adapter.confirm(proposal,new AbortController().signal)).rejects.toMatchObject({code})
 expect(send).toHaveBeenCalledTimes(1)
})

it('rejects a malformed success, a missing bearer and a network failure without mock fallback',async()=>{
 const malformed=vi.fn<typeof fetch>().mockResolvedValue(json({job:{status:'discovering'}}))
 await expect(createLiveNoticeAdapter(()=> 'test-only-session',malformed).confirm(proposal,new AbortController().signal)).rejects.toMatchObject({code:'UNAVAILABLE'})
 const noBearer=vi.fn<typeof fetch>()
 await expect(createLiveNoticeAdapter(()=>null,noBearer).confirm(proposal,new AbortController().signal)).rejects.toMatchObject({code:'UNAUTHENTICATED'})
 expect(noBearer).not.toHaveBeenCalled()
 const failure=vi.fn<typeof fetch>().mockRejectedValue(new Error('private upstream test detail'))
 await expect(createLiveNoticeAdapter(()=> 'test-only-session',failure).confirm(proposal,new AbortController().signal)).rejects.toMatchObject({code:'UNAVAILABLE'})
 expect(failure).toHaveBeenCalledTimes(1)
})
