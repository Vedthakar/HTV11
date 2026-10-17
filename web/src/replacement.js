import * as THREE from 'three';
import {SplatEdit,SplatEditSdf,SplatEditSdfType} from '@sparkjsdev/spark';

// Returns original vertex indices outside a world-space, axis-aligned box.
export function outsideIndices(geometry,matrix,box,target) {
  const position=geometry.getAttribute('position'),index=geometry.index;
  const point=new THREE.Vector3();let count=0;
  for(let i=0;i<(index?.count??position.count);i++) {
    const vertex=index?index.getX(i):i;
    point.fromBufferAttribute(position,vertex).applyMatrix4(matrix);
    if(!box.containsPoint(point))target[count++]=vertex;
  }
  return count;
}

export function createReplacement({scene,getView,getProposalEnabled,getHouseBounds,onChange}) {
  const $=s=>document.querySelector(s),box=new THREE.Box3();
  const center=new THREE.Vector3(),size=new THREE.Vector3(4,4,4);
  const helper=new THREE.Box3Helper(box,0xffb86c);helper.material.depthTest=false;helper.renderOrder=50;helper.visible=false;scene.add(helper);
  const sdf=new SplatEditSdf({type:SplatEditSdfType.BOX,opacity:0});
  const edit=new SplatEdit({sdfs:[sdf],softEdge:0,sdfSmooth:0});
  let source=null,original=null,filtered=null,originalEdits=null,originalEditable=true,key=null,enabled=false,hiddenCount=0;
  const active=()=>Boolean(source&&enabled&&getProposalEnabled()&&getView()!=='existing');
  function sync() {
    box.setFromCenterAndSize(center,size);
    sdf.position.copy(center);sdf.scale.copy(size).multiplyScalar(.5);
    const cutting=active();hiddenCount=0;
    if(source?.isPoints) {
      if(cutting) {
        source.updateWorldMatrix(true,false);
        const count=outsideIndices(original,source.matrixWorld,box,filtered.index.array);
        filtered.index.needsUpdate=true;filtered.setDrawRange(0,count);source.geometry=filtered;
        hiddenCount=(original.index?.count??original.attributes.position.count)-count;
      }else source.geometry=original;
    }else if(source?.isSplatMesh) {
      source.edits=cutting?[...(originalEdits||[]),edit]:originalEdits;
      source.editable=cutting?true:originalEditable;
    }
    helper.visible=Boolean(source&&enabled&&getProposalEnabled()&&$('#replacement-outline').checked);
    for(const [prefix,vector] of [['center',center],['size',size]])for(const axis of ['x','y','z']) {
      const input=$(`#region-${prefix}-${axis}`);if(document.activeElement!==input)input.value=vector[axis].toFixed(2);
    }
    $('#replacement-enabled').checked=enabled;
    $('#replacement-fields').hidden=!enabled;
    $('#replacement-enabled').disabled=!source;
    $('#replacement-status').textContent=!source?'Load a scan to select a replacement region.':!enabled?'No region selected.':!cutting?'Original capture visible. Switch to Proposed or Compare to apply this region.':source.isPoints?`${hiddenCount.toLocaleString()} captured points hidden in this preview.`:'Captured Gaussians inside the region are hidden in this preview.';
    $('#comparison-help').textContent=getView()==='existing'?'Existing: original capture, with the proposal hidden.':getView()==='compare'?`Compare: proposal outline over the ${cutting?'capture with the replacement region hidden':'capture'}. Camera stays fixed.`:`Proposed: solid house with ${cutting?'captured geometry inside the replacement region hidden':'the captured scene'}.`;
    onChange?.();
  }
  function fitBounds(bounds) {
    if(!bounds||bounds.isEmpty())return;
    bounds.getCenter(center);bounds.getSize(size);size.max(new THREE.Vector3(.1,.1,.1));sync();
  }
  $('#replacement-enabled').onchange=e=>{enabled=e.target.checked;sync();};
  $('#replacement-outline').onchange=sync;
  $('#region-fit-scan').onclick=()=>fitBounds(source?.isPoints?original.boundingBox?.clone().applyMatrix4(source.matrixWorld):source?.getBoundingBox?.());
  $('#region-fit-house').onclick=()=>fitBounds(getHouseBounds());
  for(const [prefix,vector] of [['center',center],['size',size]])for(const axis of ['x','y','z']) {
    const input=$(`#region-${prefix}-${axis}`);
    input.oninput=()=>{
      if(!input.value.trim())return;const value=Number(input.value);
      if(!Number.isFinite(value)||Math.abs(value)>100000||(prefix==='size'&&value<.1))return;
      vector[axis]=value;sync();
    };
    input.onblur=sync;
  }
  return {
    sync,
    isVisible:point=>!active()||!box.containsPoint(point),
    setSource(next,bounds,context) {
      if(source?.isPoints){source.geometry=original;filtered.dispose();}
      else if(source?.isSplatMesh){source.edits=originalEdits;source.editable=originalEditable;}
      source=next;original=null;filtered=null;
      if(next?.isPoints) {
        original=next.geometry;filtered=original.clone();
        filtered.setIndex(new THREE.BufferAttribute(new Uint32Array(original.index?.count??original.attributes.position.count),1));
      }else if(next?.isSplatMesh){originalEdits=next.edits;originalEditable=next.editable;}
      if(next&&key!==context){key=context;enabled=false;if(bounds){bounds.getCenter(center);bounds.getSize(size);size.multiplyScalar(.5).max(new THREE.Vector3(.1,.1,.1));}}
      sync();
    },
  };
}
