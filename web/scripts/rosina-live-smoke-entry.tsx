// Local-only dev harness entry; not imported by the product entry or production build.
import React from 'react'
import {createRoot} from 'react-dom/client'
import App from '../src/App'
import {createMockAuthAdapter} from '../src/features/personas/auth'
import '../src/index.css'
const port=new URLSearchParams(location.search).get('harnessPort')
if(!import.meta.env.DEV || !port || !/^\d{1,5}$/.test(port))throw new Error('Local harness unavailable')
const base=createMockAuthAdapter()
const auth={...base,async signInAsPersona(id:Parameters<typeof base.signInAsPersona>[0]){
 const session=await base.signInAsPersona(id)
 if(id!=='kendra')return session
 const response=await fetch(`http://127.0.0.1:${port}/session`,{cache:'no-store'})
 if(!response.ok)throw new Error('Local session unavailable')
 const {accessToken}=await response.json()
 return {...session,accessToken}
}}
createRoot(document.getElementById('root')!).render(React.createElement(App,{authAdapter:auth}))
