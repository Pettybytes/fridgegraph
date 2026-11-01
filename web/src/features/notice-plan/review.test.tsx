import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import {NoticeDraftBoundary} from './NoticeComposer'
import {NoticeReview} from './NoticeReview'
import {NoticeFailure,type NoticeAdapter,type NoticeProposal} from './types'
import {noticeInput} from './input'
import {createMockNoticeAdapter} from './mockAdapter'
import {sampleText} from './samples'
const register=()=>()=>{}
const proposal:NoticeProposal={proposalId:'test-proposal',version:1,childId:'p_nora',scenario:{referenceDate:'2026-10-26',timezone:'America/Detroit'},source:{processingSource:'text',modelId:'test-only-model'},createdAt:'2026-10-26T12:00:00-04:00',expiresAt:'2026-10-26T12:15:00-04:00',signature:'test-only-signature',changes:[{what:'Early dismissal',source:{type:'verified_quote',quote:'Dismissal at 12:30.',startOffset:0,endOffset:18},whyItMatters:'Mock conflict with the recorded pickup.',whoAffected:'Nora',unknown:['Who can help'],onConfirm:{available:false,note:'Noted, no action available.'}}],clarification:null}
function open(adapter:NoticeAdapter){const view=render(<NoticeDraftBoundary ownerKey="parent:nora" childId="p_nora" registerCleanup={register} adapter={adapter}/>);fireEvent.click(screen.getByText('Add a notice'));return view}
it('renders every review field, verified pasted source and transcription references honestly',()=>{
 const {rerender}=render(<NoticeReview proposal={proposal} submittedText="Dismissal at 12:30." busy={false} onAnswer={()=>{}}/>)
 for(const text of ['Early dismissal','Verified quote · pasted text','Dismissal at 12:30.','Why it matters','Mock conflict with the recorded pickup.','Who’s affected','Nora','What’s unknown','Who can help','What happens on confirm','Noted, no action available.'])expect(screen.getByText(text)).toBeVisible()
 expect(screen.queryByRole('button',{name:/Confirm/})).not.toBeInTheDocument()
 rerender(<NoticeReview proposal={{...proposal,changes:[{...proposal.changes[0],source:{type:'transcription',text:'Transcribed notice text',ref:'pdf:p1'},unknown:[]}]}} submittedText={null} busy={false} onAnswer={()=>{}}/>)
 expect(screen.getByText('Transcribed from PDF · page 1')).toBeVisible();expect(screen.getByText('Only page 1 is read in this version.')).toBeVisible();expect(screen.getByText('No unknowns reported.')).toBeVisible()
})
it('does not render an unverified quote or enable an unpublished action mapping',()=>{
 render(<NoticeReview proposal={{...proposal,changes:[{...proposal.changes[0],source:{type:'verified_quote',quote:'Fabricated passage',startOffset:0,endOffset:18},onConfirm:{available:true,unexpected:'not a stable mapping'}}]}} submittedText="Actual pasted text" busy={false} onAnswer={()=>{}}/>)
 expect(screen.queryByText('Fabricated passage')).not.toBeInTheDocument()
 expect(screen.getByText(/Source passage could not be verified/)).toBeVisible()
 expect(screen.queryByRole('button',{name:/Confirm/})).not.toBeInTheDocument()
})
it('answers one question by resuming the same proposal and bumped version',async()=>{
 const prepare=vi.fn<NoticeAdapter['prepare']>().mockResolvedValueOnce({...proposal,changes:[],clarification:{question:'Which date do you mean?'}}).mockResolvedValueOnce({...proposal,version:2})
 open({mode:'mock',prepare});fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:'Dismissal at 12:30.'}});fireEvent.click(screen.getByRole('button',{name:'Review notice'}))
 await screen.findByLabelText('Which date do you mean?');fireEvent.change(screen.getByLabelText('Which date do you mean?'),{target:{value:'October 26'}});fireEvent.click(screen.getByRole('button',{name:'Answer and continue'}))
 await screen.findByText('Early dismissal')
 expect(prepare).toHaveBeenCalledTimes(2)
 expect(prepare.mock.calls[1][0]).toEqual({childId:'p_nora',resume:{proposalId:'test-proposal',version:1,answer:'October 26'}})
})
it.each(['PROPOSAL_STALE','PROPOSAL_EXPIRED','UNAUTHORIZED','RATE_LIMITED'] as const)('renders %s distinctly and never auto-retries',async code=>{
 const prepare=vi.fn<NoticeAdapter['prepare']>().mockRejectedValue(new NoticeFailure(code))
 open({mode:'mock',prepare});fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:'Notice'}});fireEvent.click(screen.getByRole('button',{name:'Review notice'}))
 expect(await screen.findByRole('alert')).not.toHaveTextContent('No proposed changes')
 expect(prepare).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:/Confirm/})).not.toBeInTheDocument()
})
it('discards pending file/review results when inputs or owner change',async()=>{
 let resolve!:(value:NoticeProposal)=>void
 const prepare=vi.fn<NoticeAdapter['prepare']>(()=>new Promise(r=>{resolve=r}))
 const {rerender}=open({mode:'mock',prepare})
 fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:'Notice'}});fireEvent.click(screen.getByRole('button',{name:'Review notice'}))
 await waitFor(()=>expect(prepare).toHaveBeenCalledTimes(1))
 rerender(<NoticeDraftBoundary ownerKey="limited:other-child" childId="other-child" registerCleanup={register} adapter={{mode:'mock',prepare}}/>)
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
  expect(result.changes[0].onConfirm.available).toBe(false)
  expect(request).not.toHaveBeenCalled()
 }finally{vi.unstubAllGlobals()}
})
it('sample selection and manual drop submit the same file through the same prepare path',async()=>{
 const bytes='controlled PNG bytes',prepare=vi.fn<NoticeAdapter['prepare']>().mockResolvedValue(proposal)
 const request=vi.fn<typeof fetch>(async()=>new Response(bytes,{status:200,headers:{'Content-Type':'image/png'}}));vi.stubGlobal('fetch',request)
 try{
  open({mode:'mock',prepare})
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
