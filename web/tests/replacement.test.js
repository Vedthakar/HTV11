import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {outsideIndices,createReplacement} from '../src/replacement.js';

test('replacement clips world positions, preserves indices and boundary behavior',()=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-2,0,0,0,0,0,1,0,0,2,0,0],3));
  const box=new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,1,1));
  const output=new Uint32Array(4),matrix=new THREE.Matrix4();
  assert.equal(outsideIndices(geometry,matrix,box,output),2);
  assert.deepEqual([...output.slice(0,2)],[0,3]);
  geometry.setIndex([3,1,0]);
  assert.equal(outsideIndices(geometry,matrix,box,output),2);
  assert.deepEqual([...output.slice(0,2)],[3,0]);
  matrix.makeTranslation(10,0,0);
  assert.equal(outsideIndices(geometry,matrix,box,output),3);
  assert.deepEqual([...geometry.index.array],[3,1,0]);
});

test('preview restores source geometry and splat edits across views and captures',()=>{
  const nodes=new Map();
  globalThis.document={activeElement:null,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{value:'',checked:selector==='#replacement-outline',textContent:''});return nodes.get(selector);}};
  const node=id=>document.querySelector(id);
  let view='proposed',enabled=true;
  const replacement=createReplacement({scene:new THREE.Scene(),getView:()=>view,getProposalEnabled:()=>enabled,getHouseBounds:()=>null});
  const original=new THREE.BufferGeometry();original.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,2,0,0],3));original.computeBoundingBox();
  const cloud=new THREE.Points(original);
  replacement.setSource(cloud,original.boundingBox,'first');
  node('#replacement-enabled').onchange({target:{checked:true}});
  assert.notEqual(cloud.geometry,original);
  view='existing';replacement.sync();assert.equal(cloud.geometry,original);
  view='compare';replacement.sync();assert.notEqual(cloud.geometry,original);
  enabled=false;replacement.sync();assert.equal(cloud.geometry,original);
  replacement.setSource(null);assert.equal(cloud.geometry,original);
  enabled=true;
  const prior=[],splat={isSplatMesh:true,edits:prior,editable:false};
  replacement.setSource(splat,original.boundingBox,'second');
  assert.equal(node('#replacement-enabled').checked,false);
  node('#replacement-enabled').onchange({target:{checked:true}});
  assert.equal(splat.edits.length,1);assert.equal(splat.edits[0].sdfs[0].opacity,0);assert.equal(splat.editable,true);
  view='existing';replacement.sync();assert.equal(splat.edits,prior);assert.equal(splat.editable,false);
  replacement.setSource(null);assert.equal(splat.edits,prior);
  delete globalThis.document;
});
