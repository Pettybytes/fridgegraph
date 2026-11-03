import manifest from '../../../public/fridge/packs/ellison/manifest.json'
import {familyDinner,saveTheDate,type Slot} from './model'
const base='/fridge/packs/ellison/'
function art(id:string,text:string,x:number,y:number,width:number,rotation:number,magnet:Slot['magnet'],kind:Slot['kind']='photo',caption='Decorative family artwork'):Slot{
 return {id,kind,text,caption,position:{x,y,width,rotation},magnet,owner:null,source:'sample',image:{src:`${base}${id}-1024.webp`,srcSet:`${base}${id}-360.webp 360w, ${base}${id}-720.webp 720w, ${base}${id}-1024.webp 1024w`,alt:text}}
}
export const ellisonSlots:Slot[]=[
 art('pack_dog','The family dog',.213,.113,.139,-4,'heart'),
 art('pack_walter_navy','Navy keepsake',.356,.131,.099,5,'star','photo','Navy keepsake artwork, not a recorded family history.'),
 art('pack_crayon_family','Crayon family drawing',.213,.222,.112,3,'grade'),
 art('pack_candid_kitchen','A morning in the kitchen',.342,.223,.113,-3,'flower'),
 art('pack_loretta_card','Retirement',.21,.315,.078,-3,'heart','form',"Retirement card artwork. No booking or RSVP."),
 art('pack_permission_slip','Permission slip',.294,.32,.078,2,'bus','form','Unsigned permission slip. Not submitted; no consent record created.'),
 art('pack_sitter_schedule','Sitter schedule',.379,.316,.078,-2,'star','form','Sitter schedule artwork. No booking or availability is implied.'),
 {...familyDinner,position:{x:.342,y:.393,width:.113,rotation:3}},
 {...saveTheDate,position:{x:.211,y:.468,width:.24,rotation:-2}},
]
// Canonical seed association: src/fixtures.ts child household_members p_nora,
// p_max and p_leo -> h_a; h_a/h_b -> v_nora. Names and adult identity are unused.
const childVillages:Readonly<Record<string,string>>={p_nora:'v_nora',p_max:'v_nora',p_leo:'v_nora'}
const titles:Record<string,string>={pack_dog:'The family dog',pack_walter_navy:'Navy keepsake',pack_loretta_card:'Retirement card',pack_crayon_family:'Crayon family drawing',pack_candid_kitchen:'A morning in the kitchen',pack_candid_porch:'On the porch',pack_candid_soccer:'After soccer',pack_permission_slip:'Permission slip',pack_sitter_schedule:'Sitter schedule',pack_holiday:'Holiday keepsakes',pack_birthday:'Birthday candles',pack_keepsake:'Family keepsakes'}
export type AlbumAsset={id:string;title:string;src:string;srcSet:string}
export const ellisonAlbum:AlbumAsset[]=manifest.assets.map(asset=>({id:asset.assetId,title:titles[asset.assetId],src:`${base}${asset.assetId}-1024.webp`,srcSet:`${base}${asset.assetId}-360.webp 360w, ${base}${asset.assetId}-720.webp 720w, ${base}${asset.assetId}-1024.webp 1024w`}))
export function familyArt(childId:string):{id:string|null;label:string;slots:Slot[];album:AlbumAsset[]}{
 return childVillages[childId]===manifest.villageId
  ?{id:manifest.packId,label:'Family artwork',slots:[...ellisonSlots],album:ellisonAlbum}
  :{id:null,label:'A little space for your family',slots:[],album:[]}
}
