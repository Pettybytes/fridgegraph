export type Position = { x: number; y: number; width: number; rotation: number }
export type Slot = { id: string; kind: 'photo'|'event'|'note'|'form'; asset?: string; image?: {src:string;srcSet?:string;alt:string}; text: string; caption: string; heading?:string; lines?:string[]; variant?:'save-date'; position: Position; owner: string|null; source: 'sample'|'live'; destination?: string; paper?: 0|1|2|3; magnet?: 'apple'|'bus'|'grade'|'star'|'heart'|'flower' }
export type Goal = { id:string; title:string; horizon:string|null; status:string; period?:'DAY'|'WEEK'|'MONTH'|null; completedAt?:string|null }
export type Read<T> = { status:'loading'|'empty'|'refused'|'failed'|'unavailable' } | { status:'ready'; value:T }
export type Source = 'care'|'goals'
export interface FridgeReader { read(source:Source,childId:string,signal:AbortSignal):Promise<Read<Slot[]|Goal[]>> }
// Measured from the 2336 × 3504 source. All geometry is normalized to the full image.
export const doors = { notes:{x:.19,y:.09,width:.306,height:.47}, goals:{x:.505,y:.09,width:.309,height:.47} } as const
export const familyDinner:Slot={id:'sample-family-dinner',kind:'note',text:'Family dinner · Sunday 6 PM',caption:'Sample note. Fictional dinner reminder, not a recorded family event.',position:{x:.342,y:.354,width:.113,rotation:3},owner:null,source:'sample',paper:1,magnet:'flower'}
export const saveTheDate:Slot={id:'sample-save-the-date',kind:'event',variant:'save-date',asset:'invitation',text:'Save the date! · Baby shower & reveal party · Saturday, December 12, 2026 · 2 PM',lines:['Save the date!','Baby shower & reveal party','Saturday, December 12, 2026','2 PM'],caption:'Sample · Fictional baby shower & reveal save-the-date. Saturday, December 12, 2026 at 2 PM. No invitation sent, booking or calendar record created.',position:{x:.211,y:.457,width:.24,rotation:-2},owner:null,source:'sample',magnet:'heart'}
export const samples:Slot[] = [
 ...[
  ['sofa','A quiet afternoon',.215,.125,.131,-5,'heart'],
  ['reading','Porch reading',.351,.14,.104,5,'flower'],
  ['soccer','After soccer',.244,.238,.169,-3,'bus'],
 ].map(([asset,text,x,y,width,rotation,magnet])=>({id:`sample-${asset}`,kind:'photo' as const,asset:String(asset),text:String(text),caption:'Fictional family photograph · Sample family collage',position:{x:Number(x),y:Number(y),width:Number(width),rotation:Number(rotation)},owner:null,source:'sample' as const,magnet:magnet as Slot['magnet']})),familyDinner,saveTheDate,
]
export const notePositions:Record<'care',Position>={care:{x:.211,y:.344,width:.119,rotation:-3}}
export function loadLayout(person:string):Record<string,Position>{try{const raw=JSON.parse(localStorage.getItem(`fridge-layout:${person}`)??'{}');return Object.fromEntries(Object.entries(raw).filter(([,p])=>{const v=p as Position;return v&&[v.x,v.y,v.width,v.rotation].every(Number.isFinite)&&v.x>=.19&&v.x+v.width<=.496&&v.y>=.09&&v.y<=.49&&v.width>0&&v.width<=.306&&Math.abs(v.rotation)<=15})) as Record<string,Position>}catch{return {}}}
export function saveLayout(person:string,layout:Record<string,Position>){try{localStorage.setItem(`fridge-layout:${person}`,JSON.stringify(layout))}catch{/* Browser layout is optional, never family data. */}}

// Per-item captions a parent can edit on decorative/sample items. Browser-local only (never sent as
// family data); real pinned media carries its caption server-side through fridge_notes. Capped length.
export function loadCaptions(person:string):Record<string,string>{try{const raw=JSON.parse(localStorage.getItem(`fridge-captions:${person}`)??'{}');return Object.fromEntries(Object.entries(raw).filter(([,v])=>typeof v==='string'&&(v as string).length<=300)) as Record<string,string>}catch{return {}}}
export function saveCaptions(person:string,captions:Record<string,string>){try{localStorage.setItem(`fridge-captions:${person}`,JSON.stringify(captions))}catch{/* Browser caption is optional, never family data. */}}

// Per-goal whiteboard marker style (colour + handwriting font) a parent chooses for how they see the
// board. Browser-local only; never changes the recorded goal. Values are validated against the fixed
// allow-lists so a tampered store cannot inject an arbitrary colour or font.
export type MarkerColor='black'|'blue'|'red'|'green'
export type MarkerFont='kalam'|'caveat'
export type MarkerStyle={color:MarkerColor;font:MarkerFont}
export const MARKER_INK:Record<MarkerColor,string>={black:'#1b1b22',blue:'#1f4fb0',red:'#b4231f',green:'#1f7a3d'}
const MARKER_COLORS=new Set<MarkerColor>(['black','blue','red','green']),MARKER_FONTS=new Set<MarkerFont>(['kalam','caveat'])
export function loadMarkers(person:string):Record<string,MarkerStyle>{try{const raw=JSON.parse(localStorage.getItem(`fridge-markers:${person}`)??'{}');return Object.fromEntries(Object.entries(raw).filter(([,v])=>{const m=v as MarkerStyle;return m&&MARKER_COLORS.has(m.color)&&MARKER_FONTS.has(m.font)})) as Record<string,MarkerStyle>}catch{return {}}}
export function saveMarkers(person:string,markers:Record<string,MarkerStyle>){try{localStorage.setItem(`fridge-markers:${person}`,JSON.stringify(markers))}catch{/* Browser marker style is optional, never family data. */}}

export function authorInk(owner:string|null){if(!owner)return '#263a4a';let hash=0;for(const c of owner)hash=(hash*31+c.charCodeAt(0))>>>0;return ['#263a4a','#4d365c','#315241','#763e31'][hash%4]}
