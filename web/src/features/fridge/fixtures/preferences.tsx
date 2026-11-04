import {createRoot} from 'react-dom/client'
import {Fridge} from '../Fridge'
import {FridgePreferencesContext,createPreferenceClient} from '../preferences'
import '../../../index.css'
if(!import.meta.env.DEV)throw Error('Development fixture only')
const person=new URLSearchParams(location.search).get('parent')==='Andre'?'p_dad':'p_mom'
const client=createPreferenceClient(()=>person)
createRoot(document.getElementById('root')!).render(<FridgePreferencesContext.Provider value={client}><Fridge
 personId={person} childId="p_nora" generation={1} boardReadOnly={false}
 reader={{read:async source=>source==='goals'?{status:'ready',value:[{id:'goal_fixture',title:'Read together',horizon:'Next summer',status:'APPROVED'}]}:{status:'empty'}}}
 postedNotes={[{id:'note_fixture',text:'A fixture sticky',paperColor:'YELLOW',audience:'SHARED',author:{id:'p_mom',displayName:'Kendra'},revision:1,createdAt:'',updatedAt:''}]}
/></FridgePreferencesContext.Provider>)
