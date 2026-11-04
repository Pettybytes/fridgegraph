import type {RouteProfile} from './ors';
/** Deliberate fictional street-grid geometry. Never a road measurement or live traffic. */
export function showcaseRoute(profile:RouteProfile,from:{lng:number;lat:number},to:{lng:number;lat:number}){
 const coordinates:[number,number][]=[[from.lng,from.lat],[from.lng,to.lat],[to.lng,to.lat]];
 const radians=(n:number)=>n*Math.PI/180;
 const distanceMeters=coordinates.slice(1).reduce((sum,b,i)=>{const a=coordinates[i],dlat=radians(b[1]-a[1]),dlng=radians(b[0]-a[0]);const h=Math.sin(dlat/2)**2+Math.cos(radians(a[1]))*Math.cos(radians(b[1]))*Math.sin(dlng/2)**2;return sum+6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))},0);
 const metersPerSecond={'driving-car':11.176,'foot-walking':1.34112,'cycling-regular':4.4704}[profile];
 return {geometry:{type:'LineString' as const,coordinates},distanceMeters:Math.round(distanceMeters),durationSeconds:Math.round(distanceMeters/metersPerSecond),source:'fictional-showcase' as const,cached:false,disclaimer:'Fictional route estimate, not live traffic' as const};
}
