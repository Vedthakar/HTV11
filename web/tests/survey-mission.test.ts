import test from 'node:test';
import assert from 'node:assert/strict';
import {surveyMission} from '../src/mission/survey-mission.ts';
import {MissionStore} from '../src/mission/store.ts';
import {MOCK_MISSIONS} from '../src/mission/mock-mission.ts';
const plan={route:{geometry:{coordinates:[[-79.4,43.65],[-79.399,43.65],[-79.398,43.65]]},legs:[{distance:80},{distance:80}]},stops:[{id:'1',address:'A',score:50,buildingId:1},{id:'2',address:'B',score:60,buildingId:2}],waypoints:[]};
test('mission follows route geometry with simulated visits and monotonic times',()=>{
 const m=surveyMission(plan,1000);assert.deepEqual(m.plannedRoute,plan.route.geometry.coordinates);assert.equal(m.sites.length,2);
 assert.ok(m.track.every((p,i)=>!i||p.t>=m.track[i-1].t));
 assert.deepEqual(m.track[0].coord,plan.route.geometry.coordinates[0]);assert.deepEqual(m.track.at(-1)!.coord,plan.route.geometry.coordinates.at(-1));
 assert.ok(m.sites.every(s=>s.simulated&&(s.departedAt! - s.arrivedAt!) === 30000));
});
test('loading a survey replaces old demo mission and starts replay controls',()=>{
 const store=new MissionStore(MOCK_MISSIONS);const mission=surveyMission(plan,1000);store.loadSurvey(mission);
 assert.equal(store.active.id,mission.id);assert.equal(store.getSnapshot().missions.length,1);assert.equal(store.getSnapshot().playing,true);assert.equal(store.time,1000);
 store.stopSurvey();assert.equal(store.getSnapshot().playing,false);
});
