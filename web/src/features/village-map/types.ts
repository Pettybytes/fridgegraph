/** Frontend mock port from Bryan's map brief. These are NOT invented GraphQL fields.
 * A live transport is pending Bentley's documented wire contract. */
export type Point = [longitude:number,latitude:number]
export type Mode = 'Drive'|'Walk'|'Bike'
export type Place = {id:string;name:string;kind:'school'|'home'|'field'|'park'|'venue';point?:Point;addressRead:boolean}
export type MapPerson = {id:string;name:string;position:{point?:Point;placeId?:string;label:string;source:'home'|'area'|'event';addressRead:boolean};vehicle:'recorded'|'none'|'unknown'}
export type MapEvent = {id:string;day:string;at:string;end:string;title:string;placeId:string|null;peopleIds:string[];status:'PROPOSED'|'CONFIRMED'|'CANCELLED'}
export type MapWorld = {state:'mock'|'live';people:MapPerson[];places:Place[];events:MapEvent[];days:string[];canApprove:boolean;parentName:string}
export type RideEstimate = {amountUsd:number;capUsd:number;roadDistanceMiles:number;basis:string;paidRidePath:true;candidateId:string;state:'mock'|'live'}
export type RouteResult = {id:string;fromId:string;toId:string;mode:Mode;geometry:Point[];distanceMiles:number;durationSeconds:number;rideEstimate:RideEstimate|null;state:'mock'|'live'}
export interface VillageMapAdapter {
 readonly mode:'mock'|'live'
 readWorld(signal?:AbortSignal):Promise<MapWorld>
 route(fromId:string,toId:string,mode:Mode,signal?:AbortSignal):Promise<RouteResult>
}
export type Selection={kind:'person'|'place'|'event';id:string}|null
