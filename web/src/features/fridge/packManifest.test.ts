import {expect,it} from 'vitest'
import raw from '../../../public/fridge/packs/manifest.v1.json'
import {parsePackManifest,resolvePack} from './packManifest'
it('adds a new family through v1 data alone and resolves no other family',()=>{
 const manifest=structuredClone(raw)
 manifest.packs.push({...manifest.packs[0],id:'new-pack',familyKey:'new-family',childKeys:['new-child'],assets:[]})
 const loaded=parsePackManifest(manifest)
 expect(resolvePack(loaded,'new-child')?.id).toBe('new-pack')
 expect(resolvePack(loaded,'p_nora')?.id).toBe('ellison-fridge-v1')
 expect(resolvePack(loaded,'not-authorized-by-this-manifest')).toBeNull()
})
it('fails closed on unsupported versions, duplicate child associations, arbitrary URLs and foreign-pack sources',()=>{
 expect(parsePackManifest({...raw,version:2})).toBeNull()
 const duplicate=structuredClone(raw);duplicate.packs.push({...duplicate.packs[0],id:'other'})
 expect(parsePackManifest(duplicate)).toBeNull()
 for(const src of ['https://example.com/photo.webp','/fridge/packs/other/pack_dog-360.webp','/fridge/packs/ellison/../other/photo-360.webp']){
  const bad=structuredClone(raw);bad.packs[0].assets[0].sources[0].src=src
  expect(parsePackManifest(bad)).toBeNull()
 }
})
