import type {PreferenceClient,Preference} from '../preferences'
export function mockPreferenceClient():PreferenceClient{
 const children=new Map<string,Preference[]>()
 return {
  async read(child){return structuredClone(children.get(child)??[])},
  async write(child,patch){
   const old=children.get(child)??[]
   const rows=patch.tidy?old.map(item=>({...item,position:null})):[...old.filter(item=>item.kind!==patch.kind||item.itemId!==patch.itemId),{position:null,color:null,font:null,...old.find(item=>item.kind===patch.kind&&item.itemId===patch.itemId),...patch} as Preference]
   children.set(child,rows);return structuredClone(rows)
  },
 }
}
