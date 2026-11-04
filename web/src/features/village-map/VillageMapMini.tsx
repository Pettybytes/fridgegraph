import './village-map.css'
import {lazy,Suspense} from 'react'
import {useVillageMap,useMapState,expandMap,RideCost} from './runtime'
import type {MapController} from './controller'
const Canvas=lazy(()=>import('./MapCanvas').then(m=>({default:m.MapCanvas})))
export function VillageMapMini(){const controller=useVillageMap();return controller?<Mini controller={controller}/>:null}
function Mini({controller}:{controller:MapController}){
 const state=useMapState(controller);if(!state.world)return null
 return <section className="vm-mini" aria-label="Village map preview"><header><div>{state.world.state==='mock'&&<small>Sample data</small>}<h3>Village map</h3></div><a href="#/map" onClick={e=>{e.preventDefault();expandMap()}}>Open map</a></header><Suspense fallback={<p>Loading map preview…</p>}><Canvas controller={controller} state={state} theme={document.documentElement.classList.contains('dark')?'dark':'light'} compact onExpand={expandMap}/></Suspense>{state.route&&<p>{state.route.distanceMiles.toFixed(2)} mi · {Math.round(state.route.durationSeconds/60)} min · Estimated, not live traffic</p>}<RideCost controller={controller}/>{state.proposal==='review'&&<button onClick={()=>window.dispatchEvent(new Event('map:review-proposal'))}>Review pickup proposal</button>}{state.proposal==='approved'&&<><p>Sample approval recorded in this browser only.</p><button onClick={expandMap}>Expand simulated route preview</button></>}</section>
}
