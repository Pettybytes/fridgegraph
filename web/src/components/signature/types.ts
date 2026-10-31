/** Presentation only. These records must already be authorized by the caller's read. */
export type VillagePerson = {
 id: string
 name: string
 portraitSrc?: string
 relationship: string
 relationshipStatus?: string
 relationshipDetails?: {type:string;status:string}[]
 group: string
 /** Only when an authority read explicitly supplied it. Never derived from relationship. */
 authorityLabel?: string
}
export type VillageChild = {id:string;name:string;portraitSrc?:string}
export type VillageRingsProps = {
 child: VillageChild
 people: VillagePerson[]
 variant?: 'full' | 'compact'
 selectedPersonId?: string | null
 onSelectPerson?: (person:VillagePerson|null)=>void
 onOpenVillage?: ()=>void
}
