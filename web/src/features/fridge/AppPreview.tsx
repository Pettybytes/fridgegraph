// Evidence entry only. Not imported by the production application.
import {createRoot} from 'react-dom/client'
import {useMemo,useState} from 'react'
import App from '../../App'
import {createMockAuthAdapter} from '../personas/auth'
import {FridgeReadContext} from './FridgeReadContext'
import {previewReader} from './visualFixture'
import '../../index.css'
function AppPreview(){
 const [mode,setMode]=useState('populated')
 const auth=useMemo(()=>createMockAuthAdapter(),[])
 const reader=useMemo(()=>previewReader(mode),[mode])
 return <><aside style={{padding:12,position:'sticky',top:0,zIndex:80,background:'#fff3c9',color:'#312c20'}}>Mock data · visual preview <select aria-label="Preview source state" value={mode} onChange={event=>setMode(event.target.value)}>{['populated','empty','refused','failed'].map(value=><option key={value}>{value}</option>)}</select></aside><FridgeReadContext.Provider value={reader}><App authAdapter={auth}/></FridgeReadContext.Provider></>
}
createRoot(document.getElementById('root')!).render(<AppPreview/> )
