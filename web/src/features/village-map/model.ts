import type {Point,RouteResult} from './types'
// One simulation clock; every displayed replay value derives from this progress.
export function replayFrame(route:RouteResult,progress:number){
 const p=Math.max(0,Math.min(1,progress)),segments=route.geometry.length-1,index=Math.min(segments-1,Math.floor(p*segments)),fraction=p===1?1:p*segments-index,a=route.geometry[index],b=route.geometry[index+1]
 const point:Point=[a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction]
 return {point,progress:p,etaSeconds:Math.ceil(route.durationSeconds*(1-p)),elapsedSeconds:Math.floor(route.durationSeconds*p),arrived:p===1,completed:false,travelled:[...route.geometry.slice(0,index+1),point]}
}
export function unclutter<T extends {id:string}>(items:T[],project:(item:T)=>Point,threshold=48){
 const groups:T[][]=[];for(const item of items){const p=project(item),group=groups.find(g=>{const q=project(g[0]);return Math.hypot(p[0]-q[0],p[1]-q[1])<threshold});if(group)group.push(item);else groups.push([item])}return groups
}
