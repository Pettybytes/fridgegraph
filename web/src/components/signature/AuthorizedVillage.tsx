import {useCallback,useState} from 'react'
import {useCachedResource} from '@/lib/frontendData/resourceCache'
import {RouteSkeleton} from '@/app/RouteSkeleton'
import type {ApolloClient} from '@apollo/client'
import {RefreshCw} from 'lucide-react'
import type {VillageChild} from './types'
import {VillageRings} from './VillageRings'
import {readSignatureVillage,type VillageScene} from './villageRead'
import {sampleDadStatus} from '@/features/shared-status/sampleStatus'
type Read=<T>(read:()=>Promise<T>)=>Promise<T>
export type AuthorizedVillageProps={client:ApolloClient|null;child:VillageChild|null;runRead:Read;portraitFor?:(id:string)=>string|undefined}
type SceneState={owner:ApolloClient|null;childId:string;status:'loading'|'ready'|'refused'|'error';scene?:VillageScene}
function useScene({client,child,runRead}:AuthorizedVillageProps,revision:number){
 const load=useCallback(()=>readSignatureVillage(client!,child!.id,runRead,new AbortController().signal),[client,child?.id,runRead,revision])
 const cached=useCachedResource(child?client:null,`village:${child?.id}`,load,2500)
 const state:SceneState|null=!child||!client?null:{owner:client,childId:child.id,status:cached?.error?/UNAUTHORIZED|UNAUTHENTICATED|AUTH_ERROR/.test(cached.error)?'refused':'error':cached?.value?'ready':'loading',scene:cached?.value}
 return state
}
function VillageFeedback({status}:{status:'loading'|'refused'|'error'}){if(status==='loading')return <RouteSkeleton />;return <p className="sg-feedback" role={status==='error'?'alert':'status'}>{status==='refused'?"This isn't shared with you":"Couldn't load this just now"}</p>}
function ConnectedVillage({variant='full',...props}:AuthorizedVillageProps&{variant?:'full'|'compact'}){
 const [revision,setRevision]=useState(0),state=useScene(props,revision)
 if(!props.client)return <p className="sg-feedback" data-state="unavailable">Choose a live perspective to see the village shared with you.</p>
 if(!props.child)return <p className="sg-feedback">Choose a child shared with you.</p>
 if(!state||(state.status==='loading'&&!state.scene))return <VillageFeedback status="loading"/>
 if((state.status!=='ready'&&state.status!=='loading')||!state.scene)return <><VillageFeedback status={state.status==='refused'?'refused':'error'}/><button type="button" className="sg-refresh" onClick={()=>setRevision(value=>value+1)}>Try again</button></>
 const scene=state.scene,child={...scene.child,portraitSrc:props.portraitFor?.(scene.child.id)},people=scene.people.map(person=>({...person,portraitSrc:props.portraitFor?.(person.id),sharedStatus:sampleDadStatus(person.id)}))
 return <div data-state="live" aria-busy={state.status==='loading'}><VillageRings key={child.id} child={child} people={people} variant={variant} onOpenVillage={()=>{location.hash='#/village'}}/>{variant==='full'&&<button className="sg-refresh" type="button" onClick={()=>setRevision(value=>value+1)}><RefreshCw size={16}/> Refresh shared records</button>}</div>
}
export function AuthorizedVillagePreview(props:AuthorizedVillageProps){return <ConnectedVillage {...props} variant="compact"/>}
export type SignatureVillageProps=AuthorizedVillageProps&{childChoices:VillageChild[];childListState:'loading'|'ready'|'empty'|'refused'|'error';onSelectChild:(id:string)=>void}
export function SignatureVillage({childChoices,childListState,onSelectChild,...props}:SignatureVillageProps){
 if(childListState==='loading')return <VillageFeedback status="loading"/>
 if(childListState==='empty')return <p className="sg-feedback">No records are available to this view.</p>
 if(childListState==='refused'||childListState==='error')return <VillageFeedback status={childListState==='refused'?'refused':'error'}/>
 const selected=childChoices.find(child=>child.id===props.child?.id)??null
 return <section className="sg-workspace" aria-label="Living Village"><header className="sg-workspace-heading"><div><h2 className="sg-accessible-heading">A village around {selected?.name??'a child shared with you'}.</h2><p>Relationships, as shared with you.</p></div><label>Viewing<select aria-label="Viewing" value={selected?.id??''} onChange={event=>onSelectChild(event.target.value)}>{!selected&&<option value="">Choose a child</option>}{childChoices.map(child=><option value={child.id} key={child.id}>{child.name}</option>)}</select></label></header><ConnectedVillage {...props} child={selected}/></section>
}
