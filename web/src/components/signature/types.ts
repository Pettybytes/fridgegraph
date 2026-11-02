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
 response?: {kind:string;label:string;at?:string;fresh?:boolean}
 authorityLabel?: string
 /** Explicitly sourced status only. Never inferred from calendar or activity. */
 sharedStatus?: import('@/features/shared-status/DadStatusChip').SharedStatus | null
}
export type VillageChild = {id:string;name:string;portraitSrc?:string}
export type VillageRingsProps = {
 child: VillageChild
 people: VillagePerson[]
 variant?: 'full' | 'compact' | 'orbit'
 selectedPersonId?: string | null
 onSelectPerson?: (person:VillagePerson|null)=>void
 onOpenVillage?: ()=>void
}
