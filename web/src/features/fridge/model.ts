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
export type MarkerColor='black'|'blue'|'red'|'green'
export type MarkerFont='kalam'|'caveat'
export type MarkerStyle={color:MarkerColor;font:MarkerFont}
export const MARKER_INK:Record<MarkerColor,string>={black:'#1b1b22',blue:'#1f4fb0',red:'#b4231f',green:'#1f7a3d'}
export function authorInk(owner:string|null){if(!owner)return '#263a4a';let hash=0;for(const c of owner)hash=(hash*31+c.charCodeAt(0))>>>0;return ['#263a4a','#274c68','#315241','#763e31'][hash%4]}
