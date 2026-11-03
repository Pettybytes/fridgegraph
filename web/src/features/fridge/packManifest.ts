export type PackAsset={
 id:string;kind:'photo'|'form'|'drawing'|'keepsake'|'note'|'event'
 sources:{src:string;width:number}[];alt:string
 domCopy?:{title:string;body?:string;lines?:string[]}
 placement?:{x:number;y:number;width:number;rotation:number;magnet?:'apple'|'bus'|'grade'|'star'|'heart'|'flower'}
}
export type FamilyPack={id:string;familyKey:string;childKeys:string[];assets:PackAsset[]}
export type PackManifest={version:1;packs:FamilyPack[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
const key=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]+$/.test(v)
/** Fail closed on unsupported versions, duplicate associations, URLs or bad geometry.
 * Manifest artwork carries no read/write authority or backend persistence capability. */
export function parsePackManifest(value:unknown):PackManifest|null{
 if(!object(value)||value.version!==1||!Array.isArray(value.packs))return null
 const children=new Set<string>(),packIds=new Set<string>()
 for(const p of value.packs){
  if(!object(p)||!key(p.id)||packIds.has(p.id)||!key(p.familyKey)||!Array.isArray(p.childKeys)||!p.childKeys.length||!Array.isArray(p.assets))return null
  packIds.add(p.id)
  for(const child of p.childKeys){if(!key(child)||children.has(child))return null;children.add(child)}
  const assets=new Set<string>()
  for(const a of p.assets){
   if(!object(a)||!key(a.id)||assets.has(a.id)||!['photo','form','drawing','keepsake','note','event'].includes(String(a.kind))||typeof a.alt!=='string'||!Array.isArray(a.sources))return null
   assets.add(a.id)
   if(!a.sources.length&&a.kind!=='note')return null
   for(const src of a.sources)if(!object(src)||typeof src.src!=='string'||!/^\/fridge\/(packs\/[a-z0-9-]+|samples)\/[a-z0-9_-]+-[0-9]+\.webp$/.test(src.src)||!Number.isFinite(src.width)||Number(src.width)<=0)return null
   if(a.domCopy&&(!object(a.domCopy)||typeof a.domCopy.title!=='string'||(a.domCopy.body!==undefined&&typeof a.domCopy.body!=='string')||(a.domCopy.lines!==undefined&&(!Array.isArray(a.domCopy.lines)||!a.domCopy.lines.every((line:unknown)=>typeof line==='string')))))return null
   if(a.placement){
    const g=a.placement
    if(!object(g)||![g.x,g.y,g.width,g.rotation].every(Number.isFinite)||Number(g.x)<.19||Number(g.x)+Number(g.width)>.496||Number(g.y)<.09||Number(g.y)>.55||Number(g.width)<=0||Math.abs(Number(g.rotation))>15||g.magnet!==undefined&&!['apple','bus','grade','star','heart','flower'].includes(String(g.magnet)))return null
   }
  }
 }
 return value as PackManifest
}
export function resolvePack(manifest:PackManifest|null,childKey:string){return manifest?.packs.find(pack=>pack.childKeys.includes(childKey))??null}
