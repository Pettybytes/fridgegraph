// Development review only. The embedded app uses the explicit dev mock-auth flag.
import {createRoot} from 'react-dom/client'
import {PhoneFrame} from '../src/components/fg/PhoneFrame'
import '../src/index.css'
createRoot(document.getElementById('root')!).render(<div style={{display:'grid',placeItems:'center',padding:24}}><PhoneFrame label="Kendra" context="Village map" status="sample"><iframe title="Village map app" src="/#/map" style={{border:0,width:'100%',height:'100%',display:'block'}}/></PhoneFrame></div>)
