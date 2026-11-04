import type {ApolloClient} from '@apollo/client'
import {useChildAccess} from '@/features/personas/childContext'
import {useSession} from '@/features/personas/Session'
import {portraitFor} from '@/components/fg/portraits'
import {SignatureVillage,AuthorizedVillagePreview} from './AuthorizedVillage'
const portrait=(id:string)=>portraitFor({personId:id})
export function SignatureVillageRoute({client}:{client:ApolloClient|null}){
 const access=useChildAccess(),{runRead}=useSession()
 if(!access)return <p>No records are available to this view.</p>
 const choices=access.authorized.status==='ready'?access.authorized.children.map(child=>({id:child.id,name:child.displayName??'Name not shared'})):[]
 return <SignatureVillage client={client} child={{id:access.selectedChildId,name:access.selectedChildName}} childChoices={choices} childListState={access.authorized.status} onSelectChild={access.selectChild} runRead={runRead} portraitFor={portrait}/>
}
export function ConnectedVillagePreview({client}:{client:ApolloClient|null}){
 const access=useChildAccess(),{runRead}=useSession()
 if(!access||access.authorized.status!=='ready')return <p>{access?.authorized.status==='loading'?'Loading the village shared with you…':access?.authorized.status==='refused'?"This isn't shared with you":access?.authorized.status==='error'?"Couldn't load this just now":'No records are available to this view.'}</p>
 const selected=access.authorized.children.find(child=>child.id===access.selectedChildId)
 return <AuthorizedVillagePreview client={client} child={selected?{id:selected.id,name:selected.displayName??'Name not shared'}:null} runRead={runRead} portraitFor={portrait}/>
}
