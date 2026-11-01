import {mapRouteError} from './liveAdapter'
import type {VillageMapAdapter,MapWorld,Mode,RouteResult,Selection} from './types'
export type MapState={world:MapWorld|null;error:string;loading:boolean;day:string;selection:Selection;mode:Mode;route:RouteResult|null;routing:boolean;proposal:'none'|'review'|'approved';acceptedOverCap:boolean;progress:number;playing:boolean;following:boolean;fitRevision:number}
export class MapController{
 private state:MapState={world:null,error:'',loading:true,day:'2026-11-03',selection:null,mode:'Drive',route:null,routing:false,proposal:'none',acceptedOverCap:false,progress:0,playing:false,following:true,fitRevision:0}
 private listeners=new Set<()=>void>();private alive=true;private revision=0;private abort=new AbortController()
 private routeTarget:{fromId:string;toId:string}|null=null
 readonly adapter:VillageMapAdapter
 constructor(adapter:VillageMapAdapter){this.adapter=adapter}
 getSnapshot=()=>this.state
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
 private patch(change:Partial<MapState>){if(!this.alive)return;this.state={...this.state,...change};this.listeners.forEach(f=>f())}
 async load(){try{const world=await this.adapter.readWorld(this.abort.signal);this.patch({world,loading:false,error:'',day:world.days.includes(this.state.day)?this.state.day:world.days[0]??this.state.day})}catch(error){this.patch({loading:false,error:error instanceof Error&&error.message==='UNAUTHORIZED'?"This isn't shared with you.":"Couldn't load this just now."})}}
 select(selection:Selection){if(!selection){this.patch({selection});return}const world=this.state.world;if(!world)return;const list=selection.kind==='person'?world.people:selection.kind==='place'?world.places:world.events;if(list.some(item=>item.id===selection.id))this.patch({selection})}
 setDay(day:string){if(this.state.world?.days.includes(day))this.patch({day,selection:null})}
 async route(fromId:string,toId:string,mode:Mode=this.state.mode){
  const world=this.state.world;if(!world?.people.some(p=>p.id===fromId)||!world.places.some(p=>p.id===toId))return
  this.routeTarget={fromId,toId};this.abort.abort();this.abort=new AbortController();const revision=++this.revision
  this.patch({mode,routing:true,route:null,proposal:'none',acceptedOverCap:false,progress:0,playing:false,error:'',selection:{kind:'place',id:toId}})
  try{const route=await this.adapter.route(fromId,toId,mode,this.abort.signal);if(this.alive&&revision===this.revision){if(route.mode!==mode)throw Error('ROUTE_UNAVAILABLE');this.patch({route,routing:false,following:true,fitRevision:this.state.fitRevision+1})}}catch(error){if(this.alive&&revision===this.revision&&!(error instanceof DOMException&&error.name==='AbortError'))this.patch({routing:false,error:mapRouteError(error)})}
 }
 setMode(mode:Mode){const target=this.routeTarget;if(target)void this.route(target.fromId,target.toId,mode);else this.patch({mode})}
 propose(){if(this.state.world?.state==='mock'&&this.state.route&&!this.state.routing)this.patch({proposal:'review',acceptedOverCap:false})}
 acceptOverCap(value:boolean){this.patch({acceptedOverCap:value})}
 approve(){const {world,route,proposal,acceptedOverCap}=this.state;if(!world?.canApprove||!route||proposal!=='review')return false;const ride=route.rideEstimate;if(ride&&ride.amountUsd>ride.capUsd&&!acceptedOverCap)return false;this.patch({proposal:'approved'});return true}
 // Replay is presentation only. No adapter mutation exists and no record is appended.
 play(){if(this.state.proposal==='approved')this.patch({playing:true,progress:this.state.progress===1?0:this.state.progress})}
 pause(){this.patch({playing:false})}
 tick(deltaMs:number){if(!this.state.playing)return;const progress=Math.min(1,this.state.progress+Math.max(0,deltaMs)/12000);this.patch({progress,playing:progress<1})}
 scrub(progress:number){this.patch({progress:Math.max(0,Math.min(1,progress)),playing:false})}
 manualMove(){this.patch({following:false})}
 follow(){this.patch({following:true,fitRevision:this.state.fitRevision+1})}
 dispose=()=>{this.alive=false;this.routeTarget=null;this.adapter.dispose?.();this.abort.abort();++this.revision;this.state={...this.state,world:null,route:null,selection:null,proposal:'none',progress:0,playing:false};this.listeners.forEach(f=>f());this.listeners.clear()}
}
