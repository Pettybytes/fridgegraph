import type {CatalogAction} from './catalog'

/** Identities outlive provisional rendering; availability is checked again at confirmation. */
export class Proposals {
  private nextTurn=0
  private records=new Map<string,{turn:number;action:CatalogAction;available:boolean}>()
  begin(){return ++this.nextTurn}
  key(turn:number,action:CatalogAction){
    return `${turn}:${action.id}:${JSON.stringify(Object.entries(action.args).sort(([a],[b])=>a.localeCompare(b)))}`
  }
  offer(turn:number,action:CatalogAction){
    // Catalog arguments are validated scalar values. Property order is not identity.
    const key=this.key(turn,action)
    this.records.set(key,{turn,action,available:true})
    return key
  }
  reconcile(turn:number,actions:CatalogAction[]){
    this.withdraw(turn)
    return actions.map(action=>this.offer(turn,action))
  }
  withdraw(turn:number){for(const record of this.records.values())if(record.turn===turn)record.available=false}
  allows(key:string,action:CatalogAction){const record=this.records.get(key);return !!record?.available&&record.action.id===action.id&&JSON.stringify(Object.entries(record.action.args).sort())===JSON.stringify(Object.entries(action.args).sort())}
  clear(){this.records.clear()}
}
