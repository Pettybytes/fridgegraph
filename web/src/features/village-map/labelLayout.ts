export type Box={x:number;y:number;width:number;height:number}
export type LabelAnchor={id:string;x:number;y:number;text:string;priority:number}
export const intersects=(a:Box,b:Box)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y
// Screen-space only. Never manufactures or moves geographic coordinates.
// Leave crowded captions in the accessible marker/menu and planner instead of covering portraits.
export function layoutLabels(anchors:LabelAnchor[],markers:Box[],viewport:Box){
 const occupied=[...markers],result=new Map<string,Box>()
 for(const a of [...anchors].sort((a,b)=>b.priority-a.priority)){
  const width=144,height=40,gap=38
  const candidates=[
   {x:a.x-width/2,y:a.y+gap,width,height},
   {x:a.x-width/2,y:a.y-gap-height,width,height},
   {x:a.x+gap,y:a.y-height/2,width,height},
   {x:a.x-gap-width,y:a.y-height/2,width,height},
  ]
  const box=candidates.find(b=>b.x>=viewport.x&&b.y>=viewport.y&&b.x+b.width<=viewport.x+viewport.width&&b.y+b.height<=viewport.y+viewport.height&&!occupied.some(o=>intersects(b,o)))
  if(box){result.set(a.id,box);occupied.push({x:box.x-4,y:box.y-4,width:box.width+8,height:box.height+8})}
 }
 return result
}
