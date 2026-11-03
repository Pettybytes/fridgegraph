import {useState} from 'react'
import {Dialog} from 'radix-ui'
import type {AlbumAsset} from './packs'
/** Decorative-only browser. No mutation transport until validated pack IDs and
 * authorized attachment reads exist. Never sends art to Rosina as family facts. */
export function FamilyAlbum({assets,readOnly}:{assets:AlbumAsset[];readOnly:boolean}){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState<string|null>(null)
 const asset=assets.find(item=>item.id===selected)
 return <Dialog.Root open={open} onOpenChange={value=>{setOpen(value);if(!value)setSelected(null)}}>
  <Dialog.Trigger className="fridge-album-trigger">Add from family album</Dialog.Trigger>
  <Dialog.Portal><Dialog.Overlay className="fridge-overlay"/><Dialog.Content className="fridge-dialog fridge-album">
   <Dialog.Title>Your family album</Dialog.Title>
   <Dialog.Description>Decorative artwork · preview only. Pinning, replacing and removing album pictures aren’t available yet.</Dialog.Description>
   {readOnly&&<p>Read-only perspective.</p>}
   {!assets.length?<p>Your family album has room to grow. No pictures have been provided yet.</p>:<>
    <div className="fridge-album-grid" role="group" aria-label="Choose artwork to preview">{assets.map(item=><button key={item.id} aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}><img src={item.src} srcSet={item.srcSet} sizes="(max-width:600px) 80vw, 320px" loading="lazy" alt=""/><span>{item.title}</span></button>)}</div>
    {asset&&<section aria-label="Artwork preview"><h3>{asset.title}</h3><img src={asset.src} srcSet={asset.srcSet} sizes="700px" alt={asset.title}/>{asset.body&&<p>{asset.body}</p>}<p>This preview hasn’t changed your fridge.</p></section>}
    {!readOnly&&<button disabled>Pin to fridge unavailable</button>}
   </>}
   <Dialog.Close>Close album</Dialog.Close>
  </Dialog.Content></Dialog.Portal>
 </Dialog.Root>
}
