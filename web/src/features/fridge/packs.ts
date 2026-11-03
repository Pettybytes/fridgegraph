import {familyDinner,saveTheDate,samples,type Slot} from './model'
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
// Explicit recorded identity mapping: fixtures.ts places p_nora in h_a/h_b, village v_nora.
// The selected child, never a display name or the session's default household, chooses the art.
const packsByChild:Readonly<Record<string,readonly Slot[]>>={p_nora:ellisonSlots}
export function familyArt(childId:string):{label:string;slots:Slot[]}{
 const pack=packsByChild[childId]
 return pack?{label:'Sample Ellison family art pack',slots:[...pack]}:{label:'Sample family collage',slots:samples}
}
