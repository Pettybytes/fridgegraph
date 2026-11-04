import type {FridgeNoteRecord} from './editingContract'
/** One deterministic winner for older duplicate captions, for both reads and saves. */
export function latestCaptions(notes:FridgeNoteRecord[]):FridgeNoteRecord[]{
 const byRef=new Map<string,FridgeNoteRecord>()
 for(const note of [...notes].sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)||a.revision-b.revision||a.id.localeCompare(b.id))){
  if(note.attachmentRef?.startsWith('fridge-art:'))byRef.set(note.attachmentRef,note)
 }
 return [...byRef.values()]
}
