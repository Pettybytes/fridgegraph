import {createRoot} from 'react-dom/client'
import {useState} from 'react'
import {Fridge} from './Fridge'
import type {FridgeReader} from './model'
import '../../index.css'
const reader:FridgeReader={async read(source){if(source==='goals')return {status:'ready',value:[{id:'sample-goal-1',title:'Read together after dinner',horizon:'When evenings allow',status:'APPROVED'},{id:'sample-goal-2',title:'Try growing herbs',horizon:null,status:'PROPOSED'}]};return {status:'empty'}}}
function Preview(){const [mode,setMode]=useState('sample');const selected:FridgeReader=mode==='refused'?{async read(){return {status:'refused'}}}:mode==='failed'?{async read(){return {status:'failed'}}}:reader;return <><aside style={{padding:12}}>Offline preview · Sample goals <select aria-label="Preview perspective" value={mode} onChange={e=>setMode(e.target.value)}><option value="sample">Family</option><option value="guide">Read-only guide</option><option value="refused">Refused</option><option value="failed">Failed</option></select></aside><Fridge personId={mode} childId="preview-child" generation={0} reader={selected} readOnly={mode==='guide'}/></>}
createRoot(document.getElementById('root')!).render(<Preview/> )
