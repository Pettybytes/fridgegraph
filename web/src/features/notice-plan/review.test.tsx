import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {expect,it,vi} from 'vitest'
import {NoticeDraftBoundary} from './NoticeComposer'
import {NoticeReview} from './NoticeReview'
import {NoticeFailure,type NoticeAdapter,type NoticeProposal} from './types'
import {noticeInput} from './input'
import {createMockNoticeAdapter} from './mockAdapter'
import {sampleText} from './samples'
const register=()=>()=>{}
const proposal:NoticeProposal={proposalId:'test-proposal',version:1,childId:'p_nora',scenario:{referenceDate:'2026-10-26',timezone:'America/Detroit'},source:{processingSource:'text',modelId:'test-only-model'},createdAt:'2026-10-26T12:00:00-04:00',expiresAt:'2026-10-26T12:15:00-04:00',signature:'test-only-signature',claims:{proposalId:'test-proposal',version:1,callerId:'p_mom',childId:'p_nora',scenarioDate:'2026-10-26',action:'none',params:null,scheduleFingerprint:'test-only',expiresAt:'2026-10-26T12:15:00-04:00'},changes:[{what:'Early dismissal',source:{type:'verified_quote',quote:'Dismissal at 12:30.',startOffset:0,endOffset:18},whyItMatters:'Mock conflict with the recorded pickup.',whoAffected:'Nora',unknown:['Who can help'],onConfirm:{available:false,note:'Noted, no action available.'}}],clarification:null}
const confirm=vi.fn<NoticeAdapter['confirm']>().mockResolvedValue({job:{id:'mock-job',status:'discovering'}})
function open(adapter:NoticeAdapter,canConfirm=false){const view=render(<NoticeDraftBoundary ownerKey="parent:nora" childId="p_nora" registerCleanup={register} adapter={adapter} canConfirm={canConfirm}/>);fireEvent.click(screen.getByText('Add a notice'));return view}
const confirmable:NoticeProposal={...proposal,claims:{...proposal.claims,action:'requestPickup',params:{asOf:'2026-10-26',window:'afternoon'}},changes:[{...proposal.changes[0],onConfirm:{action:'requestPickup',params:{asOf:'2026-10-26',window:'afternoon'}}}]}
async function reviewConfirmable(adapter:NoticeAdapter,canConfirm=true){const view=open(adapter,canConfirm);fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:'Dismissal at 12:30.'}});fireEvent.click(screen.getByRole('button',{name:'Review notice'}));await screen.findByText('Early dismissal');return view}
it('renders every review field, verified pasted source and transcription references honestly',()=>{
 const {rerender}=render(<NoticeReview proposal={proposal} submittedText="Dismissal at 12:30." busy={false} onAnswer={()=>{}}/>)
 for(const text of ['Early dismissal','Verified quote · pasted text','Dismissal at 12:30.','Why it matters','Mock conflict with the recorded pickup.','Who’s affected','Nora','What’s unknown','Who can help','What happens on confirm','Noted, no action available.'])expect(screen.getByText(text)).toBeVisible()
 expect(screen.queryByRole('button',{name:/Confirm/})).not.toBeInTheDocument()
 rerender(<NoticeReview proposal={{...proposal,changes:[{...proposal.changes[0],source:{type:'transcription',text:'Transcribed notice text',ref:'pdf:p1'},unknown:[]}]}} submittedText={null} busy={false} onAnswer={()=>{}}/>)
 expect(screen.getByText('Transcribed from PDF · page 1')).toBeVisible();expect(screen.getByText('Only page 1 is read in this version.')).toBeVisible();expect(screen.getByText('No unknowns reported.')).toBeVisible()
})
it('does not render an unverified quote or enable an action that does not match signed claims',()=>{
 render(<NoticeReview proposal={{...proposal,changes:[{...proposal.changes[0],source:{type:'verified_quote',quote:'Fabricated passage',startOffset:0,endOffset:18},onConfirm:{action:'requestPickup',params:{asOf:'2026-10-26',window:'afternoon'}}}]}} submittedText="Actual pasted text" busy={false} canConfirm onAnswer={()=>{}}/>)
 expect(screen.queryByText('Fabricated passage')).not.toBeInTheDocument()
 expect(screen.getByText(/Source passage could not be verified/)).toBeVisible()
 expect(screen.queryByRole('button',{name:/Confirm/})).not.toBeInTheDocument()
})
it('answers one question by resuming the same proposal and bumped version',async()=>{
 const prepare=vi.fn<NoticeAdapter['prepare']>().mockResolvedValueOnce({...proposal,changes:[],clarification:{question:'Which date do you mean?'}}).mockResolvedValueOnce({...proposal,version:2})
 open({mode:'mock',prepare,confirm});fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:'Dismissal at 12:30.'}});fireEvent.click(screen.getByRole('button',{name:'Review notice'}))
 await screen.findByLabelText('Which date do you mean?');fireEvent.change(screen.getByLabelText('Which date do you mean?'),{target:{value:'October 26'}});fireEvent.click(screen.getByRole('button',{name:'Answer and continue'}))
 await screen.findByText('Early dismissal')
 expect(prepare).toHaveBeenCalledTimes(2)
 expect(prepare.mock.calls[1][0]).toEqual({childId:'p_nora',notice:{kind:'text',text:'Dismissal at 12:30.'},resume:{proposalId:'test-proposal',version:1,answer:'October 26'}})
})
it.each(['PROPOSAL_STALE','PROPOSAL_EXPIRED','UNAUTHORIZED','RATE_LIMITED'] as const)('renders %s distinctly and never auto-retries',async code=>{
 const prepare=vi.fn<NoticeAdapter['prepare']>().mockRejectedValue(new NoticeFailure(code))
 open({mode:'mock',prepare,confirm});fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:'Notice'}});fireEvent.click(screen.getByRole('button',{name:'Review notice'}))
 expect(await screen.findByRole('alert')).not.toHaveTextContent('No proposed changes')
 expect(prepare).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:/Confirm/})).not.toBeInTheDocument()
})
it('discards pending file/review results when inputs or owner change',async()=>{
 let resolve!:(value:NoticeProposal)=>void
 const prepare=vi.fn<NoticeAdapter['prepare']>(()=>new Promise(r=>{resolve=r}))
 const {rerender}=open({mode:'mock',prepare,confirm})
 fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:'Notice'}});fireEvent.click(screen.getByRole('button',{name:'Review notice'}))
 await waitFor(()=>expect(prepare).toHaveBeenCalledTimes(1))
 rerender(<NoticeDraftBoundary ownerKey="limited:other-child" childId="other-child" registerCleanup={register} adapter={{mode:'mock',prepare,confirm}}/>)
 expect(prepare.mock.calls[0][1].aborted).toBe(true)
 await act(async()=>resolve(proposal))
 expect(screen.queryByText('Early dismissal')).not.toBeInTheDocument()
})
it('rejects unsupported formats and size limits before reading content',async()=>{
 const signal=new AbortController().signal
 await expect(noticeInput('',[new File(['x'],'unknown.bin',{type:'application/octet-stream'})],signal)).rejects.toMatchObject({code:'UNSUPPORTED_MEDIA_TYPE'})
 await expect(noticeInput('x'.repeat(20001),[],signal)).rejects.toMatchObject({code:'PAYLOAD_TOO_LARGE'})
 const large=new File(['x'],'large.png',{type:'image/png'});Object.defineProperty(large,'size',{value:8_000_001})
 await expect(noticeInput('',[large],signal)).rejects.toMatchObject({code:'PAYLOAD_TOO_LARGE'})
})
it('uses Claude’s exact pasted sample in the mock without network or writes',async()=>{
 const request=vi.fn();vi.stubGlobal('fetch',request)
 try{
  const result=await createMockNoticeAdapter('Nora Ellison').prepare({childId:'p_nora',notice:{kind:'text',text:sampleText}},new AbortController().signal)
  expect(result.scenario.referenceDate).toBe('2026-10-26')
  expect(result.changes[0].whyItMatters).toContain('2 hours 30 minutes')
  expect(result.changes[0].source.type).toBe('verified_quote')
  expect(result.changes[0].onConfirm).toEqual({action:'requestPickup',params:{asOf:'2026-10-26',window:'afternoon'}})
  expect(request).not.toHaveBeenCalled()
 }finally{vi.unstubAllGlobals()}
})
it('recognizes #89’s merged canonical sample PDF by content, not filename',async()=>{
 const bytes=readFileSync(resolve(process.cwd(),'public/samples/notice-plan/notice-a-early-dismissal.pdf'))
 const adapter=createMockNoticeAdapter('Nora','p_mom',true)
 const result=await adapter.prepare({childId:'p_nora',notice:{kind:'pdf',mimeType:'application/pdf',dataBase64:bytes.toString('base64')}},new AbortController().signal)
 expect(result.changes[0].onConfirm).toEqual({action:'requestPickup',params:{asOf:'2026-10-26',window:'afternoon'}})
 expect(result.changes[0].source.type).toBe('transcription')
})
it('sample selection and manual drop submit the same file through the same prepare path',async()=>{
 const bytes='controlled PNG bytes',prepare=vi.fn<NoticeAdapter['prepare']>().mockResolvedValue(proposal)
 const request=vi.fn<typeof fetch>(async()=>new Response(bytes,{status:200,headers:{'Content-Type':'image/png'}}));vi.stubGlobal('fetch',request)
 try{
  open({mode:'mock',prepare,confirm})
  fireEvent.click(screen.getByRole('button',{name:'Try a sample'}));fireEvent.click(screen.getByRole('button',{name:'Use early dismissal notice (PNG)'}))
  await screen.findByText('notice-a-early-dismissal.png');fireEvent.click(screen.getByRole('button',{name:'Review notice'}));await waitFor(()=>expect(prepare).toHaveBeenCalledTimes(1))
  const first=prepare.mock.calls[0][0]
  fireEvent.drop(screen.getByText('Drop a notice here').closest('div')!,{dataTransfer:{files:[new File([bytes],'manual.png',{type:'image/png'})]}})
  fireEvent.click(screen.getByRole('button',{name:'Review notice'}));await waitFor(()=>expect(prepare).toHaveBeenCalledTimes(2))
  expect(prepare.mock.calls[1][0]).toEqual(first)
  expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][0]).toBe('/samples/notice-plan/notice-a-early-dismissal.png')
  expect(within(screen.getByRole('region',{name:'Review proposed changes'})).queryByRole('button',{name:/Confirm/})).not.toBeInTheDocument()
 }finally{vi.unstubAllGlobals()}
})
it('shows the parent-only confirm step, calls once on click, then shows a mock request rather than an arranged pickup',async()=>{
 const prepare=vi.fn<NoticeAdapter['prepare']>().mockResolvedValue(confirmable)
 const doConfirm=vi.fn<NoticeAdapter['confirm']>().mockResolvedValue({job:{id:'mock-job',status:'discovering'}})
 await reviewConfirmable({mode:'mock',prepare,confirm:doConfirm})
 expect(doConfirm).not.toHaveBeenCalled()
 const button=screen.getByRole('button',{name:'Confirm mock pickup request'})
 fireEvent.click(button)
 await screen.findByText('Mock pickup request shown')
 expect(doConfirm).toHaveBeenCalledTimes(1)
 expect(doConfirm.mock.calls[0][0]).toEqual(confirmable)
 expect(screen.getByText(/No real record was created, and pickup is not arranged yet/)).toBeVisible()
 expect(screen.getByRole('link',{name:'View Mission Control'})).toHaveAttribute('href','#/mission-control')
 expect(screen.queryByRole('button',{name:'Confirm mock pickup request'})).not.toBeInTheDocument()
})
it('keeps live review read-only until click and never presents its result as a mock',async()=>{
 const prepare=vi.fn<NoticeAdapter['prepare']>().mockResolvedValue(confirmable)
 const doConfirm=vi.fn<NoticeAdapter['confirm']>().mockResolvedValue({job:{id:'persisted-job',status:'discovering'}})
 await reviewConfirmable({mode:'live',prepare,confirm:doConfirm})
 expect(screen.getByText('Live')).toBeVisible()
 expect(screen.getByText('Review only · No changes yet')).toBeVisible()
 expect(doConfirm).not.toHaveBeenCalled()
 expect(screen.queryByText('Mock review · No records created')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Confirm pickup request'}))
 expect(await screen.findByText('Pickup request created')).toBeVisible()
 expect(screen.getByText(/Pickup is not arranged yet/)).toBeVisible()
 expect(screen.queryByText('Mock pickup request shown')).not.toBeInTheDocument()
 expect(doConfirm).toHaveBeenCalledTimes(1)
})
it('a live prepare failure stays live and never substitutes a scripted mock answer',async()=>{
 const prepare=vi.fn<NoticeAdapter['prepare']>().mockRejectedValue(new NoticeFailure('EXTRACTION_FAILED'))
 const doConfirm=vi.fn<NoticeAdapter['confirm']>()
 open({mode:'live',prepare,confirm:doConfirm},true)
 fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:'Dismissal at 12:30.'}})
 fireEvent.click(screen.getByRole('button',{name:'Review notice'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t review this notice just now.')
 expect(screen.getByText('Live')).toBeVisible()
 expect(screen.queryByText('Mock review · No records created')).not.toBeInTheDocument()
 expect(doConfirm).not.toHaveBeenCalled()
})
it('keeps Priya and review-only field trips without a confirm button',async()=>{
 const prepare=vi.fn<NoticeAdapter['prepare']>().mockResolvedValue(confirmable)
 const doConfirm=vi.fn<NoticeAdapter['confirm']>()
 const view=await reviewConfirmable({mode:'mock',prepare,confirm:doConfirm},false)
 expect(screen.queryByRole('button',{name:/Confirm mock pickup/})).not.toBeInTheDocument()
 expect(screen.getByText(/Only this child’s parent or guardian/)).toBeVisible()
 view.unmount()
 render(<NoticeReview proposal={{...proposal,changes:[{...proposal.changes[0],what:'Field trip',onConfirm:{available:false,note:'Noted, no action available.'}}]}} submittedText="Dismissal at 12:30." busy={false} canConfirm onAnswer={()=>{}}/>)
 expect(screen.getByText('Field trip')).toBeVisible()
 expect(screen.queryByRole('button',{name:/Confirm mock pickup/})).not.toBeInTheDocument()
 expect(doConfirm).not.toHaveBeenCalled()
})
it('returns the same mock job on an explicit repeat without creating a record or using network',async()=>{
 const request=vi.fn();vi.stubGlobal('fetch',request)
 try{
  const adapter=createMockNoticeAdapter('Nora','p_mom',true)
  const prepared=await adapter.prepare({childId:'p_nora',notice:{kind:'text',text:sampleText}},new AbortController().signal)
  const first=await adapter.confirm(prepared,new AbortController().signal)
  const again=await adapter.confirm(prepared,new AbortController().signal)
  expect(first).toEqual(again)
  expect(first.job.id).toContain('mock-pickup:p_nora:2026-10-26:afternoon')
  expect(request).not.toHaveBeenCalled()
 }finally{vi.unstubAllGlobals()}
})
it.each([
 ['UNAUTHENTICATED','Your session ended'],
 ['UNAUTHORIZED','This notice isn’t shared'],
 ['INVALID_PROPOSAL','This proposal can’t be used'],
 ['PROPOSAL_EXPIRED','This proposal expired'],
 ['PROPOSAL_STALE','The schedule changed'],
 ['NO_ACTION_AVAILABLE','Noted, no action available'],
 ['RATE_LIMITED','Give it a moment'],
] as const)('confirm %s shows a refusal, never success or an automatic retry',async(code,message)=>{
 const prepare=vi.fn<NoticeAdapter['prepare']>().mockResolvedValue(confirmable)
 const doConfirm=vi.fn<NoticeAdapter['confirm']>().mockRejectedValue(new NoticeFailure(code))
 await reviewConfirmable({mode:'mock',prepare,confirm:doConfirm})
 fireEvent.click(screen.getByRole('button',{name:'Confirm mock pickup request'}))
 expect(await screen.findByRole('alert')).toHaveTextContent(message)
 expect(screen.queryByText('Mock pickup request shown')).not.toBeInTheDocument()
 expect(doConfirm).toHaveBeenCalledTimes(1)
 if(code==='RATE_LIMITED')expect(screen.getByRole('button',{name:'Confirm mock pickup request'})).toBeEnabled()
 else expect(screen.getByRole('button',{name:'Confirm mock pickup request'})).toBeDisabled()
})
it('drops a late confirm after a persona switch and shows no previous-person request',async()=>{
 let resolve!:(result:{job:{id:string;status:string}})=>void
 const prepare=vi.fn<NoticeAdapter['prepare']>().mockResolvedValue(confirmable)
 const doConfirm=vi.fn<NoticeAdapter['confirm']>(()=>new Promise(r=>{resolve=r}))
 const {rerender}=await reviewConfirmable({mode:'mock',prepare,confirm:doConfirm})
 fireEvent.click(screen.getByRole('button',{name:'Confirm mock pickup request'}))
 await waitFor(()=>expect(doConfirm).toHaveBeenCalledTimes(1))
 rerender(<NoticeDraftBoundary ownerKey="priya:nora" childId="p_nora" registerCleanup={register} adapter={{mode:'mock',prepare,confirm:doConfirm}} canConfirm={false}/>)
 expect(doConfirm.mock.calls[0][1].aborted).toBe(true)
 await act(async()=>resolve({job:{id:'private-job',status:'discovering'}}))
 expect(screen.queryByText('Mock pickup request shown')).not.toBeInTheDocument()
 expect(screen.queryByText('private-job')).not.toBeInTheDocument()
})
