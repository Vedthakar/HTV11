import type {Mission,LngLat,TelemetryPoint,Site} from './types.ts';
import {distanceM} from './track.ts';
interface Stop {id:string;address:string;score:number;buildingId:number|null}
interface Plan {route:{geometry:{coordinates:number[][]};legs:{distance:number}[]};stops:Stop[];waypoints:{location:number[]}[]}
export function surveyMission(plan:Plan,startedAt=Date.now()):Mission {
  const coords=plan.route.geometry.coordinates as LngLat[];
  if(coords.length<2||!plan.stops.length||plan.route.legs.length<plan.stops.length)throw Error('Survey route has no usable track or stop legs');
  const lengths=[0];for(let i=1;i<coords.length;i++)lengths.push(lengths[i-1]+distanceM(coords[i-1],coords[i]));
  const total=lengths.at(-1)!,networkTotal=plan.route.legs.reduce((s,l)=>s+l.distance,0);
  if(!total||!networkTotal)throw Error('Survey route has zero length');
  let legDistance=0;
  const visits=plan.stops.map((stop,i)=>{legDistance+=plan.route.legs[i].distance;return {stop,d:legDistance/networkTotal*total,i};});
  const events=[...coords.map((coord,i)=>({coord,d:lengths[i],visit:-1})),...visits.map(v=>{
    let i=1;while(i<lengths.length-1&&lengths[i]<v.d)i++;
    const f=(v.d-lengths[i-1])/Math.max(lengths[i]-lengths[i-1],.0001);
    return {coord:[coords[i-1][0]+f*(coords[i][0]-coords[i-1][0]),coords[i-1][1]+f*(coords[i][1]-coords[i-1][1])] as LngLat,d:v.d,visit:v.i};
  })].sort((a,b)=>a.d-b.d||a.visit-b.visit);
  const track:TelemetryPoint[]=[],sites:Site[]=[];let dwell=0;
  for(const event of events){
    const t=startedAt+event.d/1.2*1000+dwell;
    track.push({t,coord:event.coord,heading:0,speed:1.2});
    if(event.visit>=0){const stop=plan.stops[event.visit];dwell+=30000;
      track.push({t:t+30000,coord:event.coord,heading:0,speed:0});
      sites.push({id:`SURVEY-${stop.id}`,label:`STOP ${event.visit+1}`,area:stop.address,coord:event.coord,status:'cleared',arrivedAt:t,departedAt:t+30000,hazards:[],reportStatus:'draft',simulated:true});
    }
  }
  // Duplicate boundary points must not cause time to run backwards after a dwell.
  track.sort((a,b)=>a.t-b.t);
  for(let i=0;i<track.length-1;i++){
    const a=track[i].coord,b=track[i+1].coord;track[i].heading=(Math.atan2((b[0]-a[0])*Math.cos(a[1]*Math.PI/180),b[1]-a[1])*180/Math.PI+360)%360;
  }
  return {id:`SURVEY-${startedAt}`,roverId:'SURVEY-SIM',startedAt,endedAt:track.at(-1)!.t,track,plannedRoute:coords,sites,color:'#087e9b'};
}
