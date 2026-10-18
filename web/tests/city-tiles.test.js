import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleTileKeys,mergeTiles,createTileLoader,CACHE_LIMIT} from '../src/city-tiles.js';
const tile=id=>({type:'FeatureCollection',features:[{type:'Feature',id,properties:{},geometry:null}]});
test('viewport picks available tiles and handles negative coordinates / outside coverage',()=>{
 const m={tileStep:1,bounds:[-3,0,-1,2],tiles:{'-3_0':1,'-2_0':1,'-2_1':1}};
 assert.deepEqual(visibleTileKeys([-2.8,.1,-1.2,.8],m),['-3_0','-2_0']);
 assert.deepEqual(visibleTileKeys([0,0,1,1],m),[]);
});
test('border-crossing building IDs are deduplicated',()=>assert.equal(mergeTiles([tile(1),tile(1),tile(2)]).features.length,2));
test('new viewport wins over late old response and cached tiles avoid fetching again',async()=>{
 let release;let calls=0;const values=[];
 const loader=createTileLoader({fetchTile:async key=>{calls++;if(key==='old')return new Promise(resolve=>{release=()=>resolve(tile(1));});return tile(2);},onData:data=>values.push(data),onStatus:()=>{}});
 const old=loader.load(['old']);await loader.load(['new']);release();await old;
 assert.equal(values.length,1);assert.equal(values[0].features[0].id,2);
 await loader.load(['new']);assert.equal(calls,2);
});
test('cache is bounded and failed loads clear obsolete geometry',async()=>{
 let latest,status;
 const loader=createTileLoader({fetchTile:async key=>{if(key==='bad')throw Error('offline');return tile(key);},onData:data=>{latest=data;},onStatus:s=>{status=s;}});
 for(let i=0;i<CACHE_LIMIT+3;i++)await loader.load([String(i)]);
 assert.equal(loader.cacheSize,CACHE_LIMIT);
 await loader.load(['bad']);assert.equal(latest.features.length,0);assert.match(status,/offline/);
});
