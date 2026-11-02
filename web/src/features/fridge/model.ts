export type Position = { x: number; y: number; width: number; rotation: number }
export type Slot = { id: string; kind: 'photo'|'event'|'note'; asset?: string; image?: {src:string;srcSet?:string;alt:string}; text: string; caption: string; heading?:string; position: Position; owner: string|null; source: 'sample'|'live'; destination?: string; paper?: 0|1|2|3; magnet?: 'apple'|'bus'|'grade'|'star'|'heart'|'flower' }
export type Goal = { id:string; title:string; horizon:string|null; status:string }
export type Read<T> = { status:'loading'|'empty'|'refused'|'failed' } | { status:'ready'; value:T }
export type Source = 'care'|'orbit'|'goals'
export interface FridgeReader { subscribe?(listener:()=>void):()=>void; read(source:Source,childId:string,signal:AbortSignal):Promise<Read<Slot[]|Goal[]>> }
// Measured from the 2336 × 3504 source. All geometry is normalized to the full image.
export const doors = { notes:{x:.19,y:.09,width:.306,height:.47}, goals:{x:.505,y:.09,width:.309,height:.47} } as const
export const samples:Slot[] = [
 ['sofa','A quiet afternoon',.215,.125,.131,-5,'heart'],
 ['reading','Porch reading',.351,.14,.104,5,'flower'],
 ['soccer','After soccer',.244,.238,.169,-3,'bus'],
 ['invitation','Garden afternoon',.345,.433,.103,4,'star'],
].map(([asset,text,x,y,width,rotation,magnet])=>({id:`sample-${asset}`,kind:asset==='invitation'?'event':'photo',asset:String(asset),text:String(text),caption:asset==='invitation'?'Fictional family event · A garden afternoon with lemonade and games. No date or location has been arranged.':'Fictional family photograph · Sample family collage',position:{x:Number(x),y:Number(y),width:Number(width),rotation:Number(rotation)},owner:null,source:'sample',magnet:magnet as Slot['magnet']}))
export const notePositions:Record<'care'|'orbit',Position>={care:{x:.211,y:.344,width:.119,rotation:-3},orbit:{x:.342,y:.35,width:.113,rotation:3}}
export function loadLayout(person:string):Record<string,Position>{try{const raw=JSON.parse(localStorage.getItem(`fridge-layout:${person}`)??'{}');return Object.fromEntries(Object.entries(raw).filter(([,p])=>{const v=p as Position;return v&&[v.x,v.y,v.width,v.rotation].every(Number.isFinite)&&v.x>=.19&&v.x+v.width<=.496&&v.y>=.09&&v.y<=.49&&v.width>0&&v.width<=.306&&Math.abs(v.rotation)<=15})) as Record<string,Position>}catch{return {}}}
export function saveLayout(person:string,layout:Record<string,Position>){try{localStorage.setItem(`fridge-layout:${person}`,JSON.stringify(layout))}catch{/* Browser layout is optional, never family data. */}}

export function authorInk(owner:string|null){if(!owner)return '#263a4a';let hash=0;for(const c of owner)hash=(hash*31+c.charCodeAt(0))>>>0;return ['#263a4a','#4d365c','#315241','#763e31'][hash%4]}
