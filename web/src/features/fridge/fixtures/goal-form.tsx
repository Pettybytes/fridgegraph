import {createRoot} from 'react-dom/client'
import {FridgeEditing} from '../FridgeEditing'
import {mockFridgeEditingAdapter} from '../mockEditingAdapter'
import '../fridge.css'
import '../../../index.css'
if(!import.meta.env.DEV)throw Error('Development fixture only')
createRoot(document.getElementById('root')!).render(<FridgeEditing adapter={mockFridgeEditingAdapter([],[])} childId="nora" viewer={{personId:'kendra',role:'PARENT',sessionKey:'fixture'}} section="goals"/>)
