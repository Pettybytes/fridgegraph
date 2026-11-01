/** Scope-owned ledger: retained across route remounts; discarded with the session runtime. */
export class ActivityLedger {
 private seen=new Set<string>()
 private primed=false
 observe(keys:string[]){
  const fresh=this.primed?keys.filter(key=>!this.seen.has(key)):[]
  for(const key of keys)this.seen.add(key)
  this.primed=true
  return fresh
 }
 clear(){this.seen.clear();this.primed=false}
}
