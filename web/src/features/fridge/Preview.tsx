import {createRoot} from 'react-dom/client'
import {useMemo,useState} from 'react'
import {Fridge} from './Fridge'
import {populatedSlots,previewReader} from './visualFixture'
import '../../index.css'
function Preview(){
 const [mode,setMode]=useState('populated')
 const reader=useMemo(()=>previewReader(mode),[mode])
 return <><aside style={{padding:12}}>Mock data · visual preview <select aria-label="Preview perspective" value={mode} onChange={e=>setMode(e.target.value)}><option value="populated">Populated notes</option><option value="empty">Empty sources</option><option value="guide">Read-only guide</option><option value="refused">Refused</option><option value="failed">Failed</option></select></aside><Fridge personId={mode} childId="preview-child" generation={0} reader={reader} readOnly={mode==='guide'} sampleSlots={mode==='populated'?populatedSlots:undefined}/></>
}
createRoot(document.getElementById('root')!).render(<Preview/> )
