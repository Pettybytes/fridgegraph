import {fridgeFamilies} from '../../../../src/fixtures-fridge'
import {invitationText} from '../invites/renderInvite'
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
 const family=fridgeFamilies.find(f=>f.children.some(id=>id===childId))
 if(!family)return {id:null,label:'Family artwork',slots:[],album:[]}
 const photos:Slot[]=family.photos.map((asset,index)=>({
  id:`${family.key}-${asset}`,kind:'photo',asset,text:`${family.name} · ${['A favorite afternoon','Little everyday moments','Out together'][index]}`,
  caption:'Fictional family collage photograph. Existing Higgsfield artwork.',owner:null,source:'sample',magnet:(['heart','flower','bus'] as const)[index],
  position:[{x:.215,y:.125,width:.126,rotation:-5},{x:.351,y:.14,width:.104,rotation:5},{x:.244,y:.238,width:.169,rotation:-3}][index],
 }))
 const event={childFirstName:family.name,occasion:family.occasion,date:family.date,startTime:'14:00',endTime:null,timezone:'America/Detroit' as const,placeLabel:family.place,hostName:'',message:'Please join us to celebrate!'}
 const invitation:Slot={id:`${family.key}-invitation`,kind:'event',variant:'save-date',image:{src:'/invites/sample-art.png',alt:`${family.occasion} invitation artwork`},text:family.occasion,lines:[family.occasion,...invitationText(event).slice(2,5)],caption:`Fictional invitation from the Invitations card template. ${invitationText(event).join('. ')} No invitation sent.`,owner:null,source:'sample',magnet:'heart',position:{x:.211,y:.457,width:.24,rotation:-2}}
 const slip:Slot={id:`${family.key}-permission-slip`,kind:'form',image:{src:'/fridge/samples/lincoln-permission-slip-photo.png',alt:'Fictional school permission slip'},text:'School permission slip',heading:'School paper',caption:'Fictional school permission slip. No signature or consent is recorded here.',owner:null,source:'sample',paper:0,magnet:'grade',position:{x:.219,y:.29,width:.108,rotation:-3}}
 const art=pack?slots(pack).filter(slot=>slot.variant!=='save-date'):[...photos,slip]
 const images=pack?album(pack):photos.map(slot=>({id:slot.id,title:slot.text,src:`/fridge/samples/${slot.asset}-1440.webp`,srcSet:[360,720,1440].map(w=>`/fridge/samples/${slot.asset}-${w}.webp ${w}w`).join(', '),body:slot.caption}))
 return {id:pack?.id??`${family.key}-fridge-v1`,label:'Fictional family artwork',slots:[...art,invitation],album:images}
}
