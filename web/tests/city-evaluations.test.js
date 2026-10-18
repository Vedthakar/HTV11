import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluationIndex,decorateBuildings,evaluationPoints} from '../src/city-evaluations.js';
test('only matched records colour footprints; multiple scores use minimum and unknown remains null',()=>{
 const records=[{buildingId:1,score:90},{buildingId:1,score:70},{buildingId:null,score:20}];
 const data={features:[{id:1,properties:{}},{id:2,properties:{}}]};
 const result=decorateBuildings(data,evaluationIndex(records));
 assert.equal(result.features[0].properties.evaluationScore,70);
 assert.equal(result.features[0].properties.evaluationCount,2);
 assert.equal(result.features[1].properties.evaluationScore,null);
 assert.deepEqual(data.features[0].properties,{});
});
test('unmatched locations retain markers; missing coordinates excluded and zero score retained',()=>{
 const result=evaluationPoints([{id:'a',latitude:43.6,longitude:-79.4,score:0,buildingId:null},{id:'b',latitude:null,longitude:-79.4,score:90}]);
 assert.equal(result.features.length,1);assert.equal(result.features[0].properties.evaluationScore,0);
});
