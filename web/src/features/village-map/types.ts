/** Internal frontend projection from Bryan's map brief, NOT GraphQL fields.
 * Live route transport is prepared; world projection awaits Bentley's final contract. */
export type Point = [longitude:number,latitude:number]
export type Mode = 'Drive'|'Walk'|'Bike'
export type Place = {id:string;name:string;kind:'school'|'home'|'field'|'park'|'venue';point?:Point;addressRead:boolean;coordinateState?:'SET'|'WITHHELD'|'NOT_RECORDED'}
export type MapPerson = {id:string;name:string;position:{point?:Point;placeId?:string;label:string;source:'home'|'area'|'event'|'unavailable';addressRead:boolean};vehicle:'recorded'|'none'|'unknown'}
export type MapEvent = {id:string;day:string;at:string;end:string;title:string;placeId:string|null;placeState?:'LINKED'|'UNLINKED'|'WITHHELD';peopleIds:string[];status:string}
export type StoredRideEstimate = {jobId:string;candidateId:string;candidateName:string;amountUsd:number;capUsd:number|null;distanceMiles:number|null;basis:string|null;paidRidePath:true}
export type MapWorld = {childId?:string;state:'mock'|'live';people:MapPerson[];places:Place[];events:MapEvent[];days:string[];canApprove:boolean;canReadCost:boolean;parentName:string;storedRideEstimates?:StoredRideEstimate[];rideReadState?:'ready'|'refused'|'unavailable'}
export type RideEstimate = {amountUsd:number;capUsd:number;distanceMiles:number;basis:string;paidRidePath:true;candidateId:string;state:'mock'|'live'}
export type RouteResult = {id:string;fromId:string;toId:string;mode:Mode;geometry:Point[];distanceMiles:number;durationSeconds:number;rideEstimate:RideEstimate|null;state:'mock'|'live'}
export interface VillageMapAdapter {
 placePerson?(personId:string,placeId:string):boolean
 dispose?():void
 readonly mode:'mock'|'live'
 readWorld(signal?:AbortSignal):Promise<MapWorld>
 route(fromId:string,toId:string,mode:Mode,signal?:AbortSignal):Promise<RouteResult>
}
export type Selection={kind:'person'|'place'|'event';id:string}|null
