import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {NoticeDraftBoundary} from './NoticeComposer'
import {createMockNoticeAdapter} from './mockAdapter'
import {sampleText} from './samples'
afterEach(()=>vi.unstubAllGlobals())
function setup(){
 let cleanup:(()=>void)|undefined
 const registerCleanup=vi.fn((clear:()=>void)=>{cleanup=clear;return()=>{cleanup=undefined}})
 const view=render(<NoticeDraftBoundary ownerKey="persona-a:child-a" registerCleanup={registerCleanup}/>)
 fireEvent.click(screen.getByText('Add a notice'))
 return {...view,registerCleanup,clear:()=>act(()=>cleanup?.())}
}
it('selects and drops local files without reading, accepting, uploading or submitting them',()=>{
 const request=vi.fn();vi.stubGlobal('fetch',request)
 const read=vi.spyOn(FileReader.prototype,'readAsDataURL')
 setup()
 expect(screen.getByText('Mock')).toBeVisible()
 expect(screen.getByText('Local draft only. Nothing is uploaded or created.')).toBeVisible()
 const file=new File(['unprocessed local contents'],'unverified.notice',{type:'application/x-unverified'})
 const input=screen.getByLabelText('Choose notice files locally')
 expect(input).not.toHaveAttribute('accept')
 fireEvent.change(input,{target:{files:[file]}})
 expect(screen.getByRole('list',{name:'Files selected locally'})).toHaveTextContent('unverified.notice')
 fireEvent.drop(screen.getByText('Drop a notice here').closest('div')!,{dataTransfer:{files:[new File(['other'],'second.unknown')]}})
 expect(screen.getByRole('list',{name:'Files selected locally'})).toHaveTextContent('second.unknown')
 expect(screen.queryByText('unverified.notice')).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Review notice'})).toBeDisabled()
 expect(screen.queryByRole('button',{name:/Confirm/})).not.toBeInTheDocument()
 expect(request).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled()
 read.mockRestore()
})
it('keeps pasted text inert and the sample tray honest until its contract arrives',()=>{
 const request=vi.fn();vi.stubGlobal('fetch',request);setup()
 fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:'<script>not executable</script>'}})
 expect(screen.getByLabelText('Or paste notice text')).toHaveValue('<script>not executable</script>')
 expect(document.querySelector('script')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Try a sample'}))
 expect(within(screen.getByRole('region',{name:'Sample notices'})).getByText('Sample notices aren’t available yet.')).toBeVisible()
 expect(screen.getByRole('button',{name:'Review notice'})).toBeDisabled()
 fireEvent.click(screen.getByRole('button',{name:'Review notice'}))
 expect(request).not.toHaveBeenCalled()
})
it.each(['persona-b:child-a','persona-a:child-b'])('remounts empty before paint when ownership becomes %s',ownerKey=>{
 const {rerender,registerCleanup}=setup()
 fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:'Private first draft'}})
 fireEvent.change(screen.getByLabelText('Choose notice files locally'),{target:{files:[new File(['private'],'private-first.notice')]}})
 rerender(<NoticeDraftBoundary ownerKey={ownerKey} registerCleanup={registerCleanup}/>)
 expect(screen.getByLabelText('Or paste notice text')).toHaveValue('')
 expect(screen.queryByText('private-first.notice')).not.toBeInTheDocument()
 expect(screen.getByRole('group',{name:'Notice draft'})).not.toHaveAttribute('open')
})
it('registered private cleanup clears text, file references, input value and sample-tray state',()=>{
 const {clear}=setup()
 fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:'Private draft'}})
 fireEvent.change(screen.getByLabelText('Choose notice files locally'),{target:{files:[new File(['private'],'private.notice')]}})
 fireEvent.click(screen.getByRole('button',{name:'Try a sample'}))
 clear()
 expect(screen.getByLabelText('Or paste notice text')).toHaveValue('')
 expect(screen.getByLabelText('Choose notice files locally')).toHaveValue('')
 expect(screen.queryByText('private.notice')).not.toBeInTheDocument()
 expect(screen.queryByRole('region',{name:'Sample notices'})).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Clear draft'})).toBeDisabled()
})
it('reports the recorded pickup job to the Today card only when a notice is confirmed',async()=>{
 const registerCleanup=vi.fn(()=>()=>{})
 const adapter=createMockNoticeAdapter('Nora','mock-parent',true)
 const confirmed=vi.fn()
 const listener=(event:Event)=>confirmed((event as CustomEvent).detail)
 window.addEventListener('fg:notice-confirmed',listener)
 try{
  render(<NoticeDraftBoundary ownerKey="kendra:p_nora" registerCleanup={registerCleanup} adapter={adapter} childId="p_nora" canConfirm/>)
  fireEvent.click(screen.getByText('Add a notice'))
  fireEvent.change(screen.getByLabelText('Or paste notice text'),{target:{value:sampleText}})
  fireEvent.click(screen.getByRole('button',{name:'Review notice'}))
  const review=await screen.findByRole('region',{name:'Review proposed changes'})
  // Reviewing alone records nothing and reports nothing — confirmation is the parent's decision.
  expect(confirmed).not.toHaveBeenCalled()
  fireEvent.click(within(review).getByRole('button',{name:'Confirm mock pickup request'}))
  await screen.findByText('Mock pickup request shown')
  await waitFor(()=>expect(confirmed).toHaveBeenCalledWith({childId:'p_nora',jobId:'mock-pickup:p_nora:2026-10-26:afternoon',status:'discovering',mode:'mock'}))
 }finally{window.removeEventListener('fg:notice-confirmed',listener)}
})
