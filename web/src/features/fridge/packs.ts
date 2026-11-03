import raw from '../../../public/fridge/packs/manifest.v1.json'
import {parsePackManifest,resolvePack,type FamilyPack} from './packManifest'
import type {Slot} from './model'
const manifest=parsePackManifest(raw)
export type AlbumAsset={id:string;title:string;src:string;srcSet:string;body?:string}
const album=(pack:FamilyPack):AlbumAsset[]=>pack.assets.filter(a=>a.sources.length).map(a=>({id:a.id,title:a.domCopy?.title??a.alt,body:a.domCopy?.body,src:a.sources.at(-1)!.src,srcSet:a.sources.map(s=>`${s.src} ${s.width}w`).join(', ')}))
const slots=(pack:FamilyPack):Slot[]=>pack.assets.filter(a=>a.placement).map(a=>({
 id:a.id,kind:a.kind==='drawing'||a.kind==='keepsake'?'photo':a.kind,
 text:a.domCopy?.title??a.alt,caption:a.domCopy?.body??'Decorative family artwork',owner:null,source:'sample',
 position:a.placement!,magnet:a.placement?.magnet,
 ...(a.domCopy?.lines?{variant:'save-date' as const,lines:a.domCopy.lines}:{}),
 ...(a.sources.length?{image:{src:a.sources.at(-1)!.src,srcSet:a.sources.map(s=>`${s.src} ${s.width}w`).join(', '),alt:a.alt}}:{})
}))
const ellison=resolvePack(manifest,'p_nora')
export const ellisonSlots=ellison?slots(ellison):[]
export const ellisonAlbum=ellison?album(ellison):[]
export function familyArt(childId:string):{id:string|null;label:string;slots:Slot[];album:AlbumAsset[]}{
 const pack=resolvePack(manifest,childId)
 return pack?{id:pack.id,label:'Family artwork',slots:slots(pack),album:album(pack)}:{id:null,label:'A little space for your family',slots:[],album:[]}
}
