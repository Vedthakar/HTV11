import test from 'node:test';
import assert from 'node:assert/strict';
import {planStops,distance} from '../src/map/survey-route.js';
const r=(id,score,x,buildingId=null)=>({id,address:id,score,longitude:x,latitude:43.65,buildingId});
const opts={start:[-79.4,43.65],bounds:[-79.5,43.6,-79.3,43.7],maxScore:75,limit:3,radius:2000};
test('filters missing scores, high scores, outside viewport and outside radius',()=>{
 const result=planStops([r('ok',70,-79.401),r('unknown',null,-79.402),r('high',90,-79.402),r('far',50,-79.45),r('outside',50,-80)],opts);
 assert.deepEqual(result.stops.map(r=>r.id),['ok']);
});
test('prioritizes lowest score per building, limits selection and orders from start',()=>{
 const result=planStops([r('same-high',73,-79.401,1),r('same-low',50,-79.401,1),r('far-low',40,-79.41,2),r('near',60,-79.402,3),r('extra',70,-79.403,4)],{...opts,limit:2});
 assert.equal(result.eligibleCount,4);assert.deepEqual(result.stops.map(r=>r.id),['same-low','far-low']);
});
test('zero is a valid score and input is not mutated',()=>{
 const records=[r('a',70,-79.401),r('b',0,-79.402)];const copy=JSON.stringify(records);
 assert.equal(planStops(records,{...opts,maxScore:0}).stops[0].id,'b');assert.equal(JSON.stringify(records),copy);
 assert.equal(distance(opts.start,opts.start),0);
});
