import * as THREE from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';

export const HOUSE_DEFAULTS = {width:8, depth:10, floors:2, roofHeight:2, wallColor:'#ded4c2', porch:true};

// Pure model builder: parameters in, a Three.js group out. No page or network access.
export function buildHouse(parameters) {
  const p={...HOUSE_DEFAULTS,...parameters};
  for(const [key,min,max] of [['width',3,16],['depth',3,20],['floors',1,3],['roofHeight',.4,4]]) {
    if(!Number.isFinite(p[key])||p[key]<min||p[key]>max)throw Error(`Invalid ${key}`);
  }
  if(!Number.isInteger(p.floors)||!/^#[0-9a-f]{6}$/i.test(p.wallColor))throw Error('Invalid house parameters');
  const house=new THREE.Group();house.name='Proposed house';
  const h=p.floors*2.8;
  const material=color=>new THREE.MeshStandardMaterial({color,roughness:.85});
  const wall=material(p.wallColor),trim=material('#f0eee4'),roof=material('#53666b'),foundation=material('#a6aaa4');
  const glass=new THREE.MeshStandardMaterial({color:'#6b9ba5',roughness:.3,metalness:.15});
  const wood=material('#917454');
  function box(w,h,d,x,y,z,mat,parent=house) {
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);parent.add(m);return m;
  }
  box(p.width+.25,.18,p.depth+.25,0,.09,0,foundation);
  box(p.width,h,p.depth,0,.18+h/2,0,wall);
  // Thin bands make floor count readable without pretending to model internal structure.
  for(let f=1;f<p.floors;f++)box(p.width+.06,.1,p.depth+.06,0,.18+f*2.8,0,trim);
  const roofWidth=p.width+.6,roofDepth=p.depth+.6;
  const shape=new THREE.Shape();shape.moveTo(-roofWidth/2,0);shape.lineTo(roofWidth/2,0);shape.lineTo(0,p.roofHeight);shape.closePath();
  const roofGeo=new THREE.ExtrudeGeometry(shape,{depth:roofDepth,bevelEnabled:false,steps:1});
  const top=new THREE.Mesh(roofGeo,roof);top.position.set(0,h+.18,-roofDepth/2);house.add(top);
  box(p.width+.7,.14,p.depth+.7,0,h+.18,0,trim);
  function windowAt(x,y,z,side=false) {
    const frame=box(.95,1.2,.09,x,y,z,trim);
    const pane=box(.78,1.02,.035,0,0,.055,glass,frame);
    box(.045,1.04,.025,0,0,.08,trim,frame);
    box(.8,.045,.025,0,0,.08,trim,frame);
    if(side)frame.rotation.y=Math.PI/2;
    return pane;
  }
  const count=Math.max(2,Math.floor((p.width-1)/2.5));
  for(let floor=0;floor<p.floors;floor++) {
    const y=.18+floor*2.8+1.55;
    for(let i=0;i<count;i++) {
      const x=-p.width/2+(i+1)*p.width/(count+1);
      if(floor>0||Math.abs(x)>.9)windowAt(x,y,p.depth/2+.045);
      const back=windowAt(x,y,-p.depth/2-.045);back.parent.rotation.y=Math.PI;
    }
    for(const z of [-p.depth*.25,p.depth*.25]) {
      windowAt(p.width/2+.045,y,z,true);
      const left=windowAt(-p.width/2-.045,y,z,true);left.parent.rotation.y=-Math.PI/2;
    }
  }
  box(1.08,2.15,.12,0,1.255,p.depth/2+.07,trim);
  box(.88,1.98,.14,0,1.17,p.depth/2+.15,wood);
  box(.08,.08,.04,.28,1.15,p.depth/2+.24,roof);
  if(p.porch) {
    const pw=Math.min(p.width-1,4.2),front=p.depth/2;
    box(pw,.18,1.8,0,.09,front+.9,wood);
    box(pw+.25,.16,2,0,2.65,front+.9,roof);
    for(const x of [-pw/2+.12,pw/2-.12])box(.12,2.4,.12,x,1.38,front+1.65,trim);
    box(pw*.65,.09,.35,0,.045,front+1.98,foundation);
  }
  house.userData.parameters={...p};
  return house;
}

export function disposeHouse(group) {
  const geometries=new Set(),materials=new Set();
  group.traverse(obj=>{if(obj.geometry)geometries.add(obj.geometry);if(obj.material)materials.add(obj.material);});
  for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
}

export function createHouseDesigner({scene,camera,canvas,controls,onChange,onFocus,onEditStart}) {
  const $=s=>document.querySelector(s);
  const root=new THREE.Group();scene.add(root);root.visible=false;
  let params={...HOUSE_DEFAULTS},model=null,scanBounds=null,contextKey=null;
  let enabled=false,view='proposed',manual=false,editing=false;
  const lighting=new THREE.Group();
  lighting.add(new THREE.HemisphereLight(0xfff3df,0x63777c,2.2));
  const sun=new THREE.DirectionalLight(0xffffff,2.5);sun.position.set(5,12,8);lighting.add(sun);
  scene.add(lighting);lighting.visible=false;
  const gizmo=new TransformControls(camera,canvas);gizmo.setSize(.8);
  scene.add(gizmo.getHelper());gizmo.enabled=false;gizmo.getHelper().visible=false;
  const footprint=new THREE.LineLoop(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xf0c889,depthTest:false}));
  footprint.renderOrder=40;root.add(footprint);footprint.visible=false;

  function syncPlacement() {
    for(const axis of ['x','y','z'])if(document.activeElement!==$('#place-'+axis))$('#place-'+axis).value=root.position[axis].toFixed(2);
    if(document.activeElement!==$('#place-yaw'))$('#place-yaw').value=THREE.MathUtils.radToDeg(root.rotation.y).toFixed(1);
    if(document.activeElement!==$('#place-scale'))$('#place-scale').value=root.scale.x.toFixed(2);
    $('#placement-summary').textContent=`X ${root.position.x.toFixed(2)} · Y ${root.position.y.toFixed(2)} · Z ${root.position.z.toFixed(2)} m · scale ×${root.scale.x.toFixed(2)}`;
    const a=params.width*root.scale.x,b=params.depth*root.scale.x;
    $('#house-summary').textContent=`${a.toFixed(1)} × ${b.toFixed(1)} m scaled footprint · ${((params.floors*2.8+.18+params.roofHeight)*root.scale.x).toFixed(1)} m overall height`;
  }
  function automaticAnchor() {
    root.position.set(scanBounds?scanBounds.max.x+1+params.width/2:0,scanBounds?scanBounds.min.y:0,scanBounds?scanBounds.getCenter(new THREE.Vector3()).z:0);
    root.rotation.set(0,0,0);root.scale.setScalar(1);
  }
  function stopEditing() {
    editing=false;gizmo.detach();gizmo.enabled=false;gizmo.getHelper().visible=false;
    for(const mode of ['move','rotate'])$('#placement-'+mode).setAttribute('aria-pressed','false');
  }
  function applyView() {
    root.visible=enabled&&view!=='existing';lighting.visible=root.visible;
    if(!root.visible)stopEditing();
    if(model)model.traverse(obj=>{if(obj.isMesh){obj.material.transparent=view==='compare';obj.material.opacity=view==='compare'?.35:1;obj.material.wireframe=view==='compare';obj.material.depthWrite=view!=='compare';obj.material.needsUpdate=true;}});
    footprint.visible=view==='compare';
    $('#proposal-badge').hidden=!root.visible;
    $('#proposal-badge').textContent=view==='compare'?'COMPARE · PROPOSAL OUTLINE OVER CAPTURE':'PROPOSED DESIGN · CONCEPT MODEL';
    for(const button of document.querySelectorAll('[data-design-view]')) {
      button.setAttribute('aria-pressed',String(button.dataset.designView===view));
      button.disabled=!enabled;
    }
    $('#placement-move').disabled=!root.visible;$('#placement-rotate').disabled=!root.visible;
    $('#comparison-help').textContent=view==='existing'?'Existing: captured scene only. Proposal is hidden.':view==='compare'?'Compare: proposal outline over the unchanged capture. Camera stays fixed.':'Proposed: captured scene plus the solid proposed house. Existing buildings remain visible.';
    onChange();
  }
  function rebuild() {
    if(model){root.remove(model);disposeHouse(model);}
    model=buildHouse(params);root.add(model);
    if(!manual)automaticAnchor();
    footprint.geometry.dispose();footprint.geometry=new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-params.width/2,.02,-params.depth/2),new THREE.Vector3(params.width/2,.02,-params.depth/2),
      new THREE.Vector3(params.width/2,.02,params.depth/2),new THREE.Vector3(-params.width/2,.02,params.depth/2)]);
    for(const key of ['width','depth','floors','roofHeight']) {
      $('#house-'+key).value=params[key];$('#house-'+key+'-value').textContent=key==='floors'?params[key]:`${params[key].toFixed(1)} m`;
    }
    $('#house-color').value=params.wallColor;$('#house-porch').checked=params.porch;
    syncPlacement();applyView();
  }
  for(const key of ['width','depth','floors','roofHeight'])$('#house-'+key).addEventListener('input',event=>{params[key]=Number(event.target.value);rebuild();});
  $('#house-color').addEventListener('input',event=>{params.wallColor=event.target.value;rebuild();});
  $('#house-porch').addEventListener('change',event=>{params.porch=event.target.checked;rebuild();});
  $('#house-enabled').addEventListener('change',event=>{
    enabled=event.target.checked;$('#house-settings').hidden=!enabled;
    if(enabled){view='proposed';rebuild();}else applyView();onFocus();
  });
  $('#house-reset').onclick=()=>{params={...HOUSE_DEFAULTS};rebuild();onFocus();};
  $('#house-focus').onclick=()=>{if(view==='existing'){view='proposed';applyView();}onFocus(true);};
  for(const button of document.querySelectorAll('[data-design-view]'))button.onclick=()=>{view=button.dataset.designView;applyView();};
  for(const axis of ['x','y','z'])$('#place-'+axis).addEventListener('input',event=>{
    if(event.target.value.trim()==='')return;
    const value=Number(event.target.value);if(!Number.isFinite(value)||Math.abs(value)>100000){syncPlacement();return;}
    manual=true;root.position[axis]=value;syncPlacement();onChange();
  });
  $('#place-yaw').addEventListener('input',event=>{
    if(event.target.value.trim()==='')return;
    const value=Number(event.target.value);if(!Number.isFinite(value)){syncPlacement();return;}
    manual=true;root.rotation.y=THREE.MathUtils.degToRad(((value%360)+360)%360);syncPlacement();onChange();
  });
  $('#place-scale').addEventListener('input',event=>{
    if(event.target.value.trim()==='')return;
    const value=Number(event.target.value);if(!Number.isFinite(value)||value<.1||value>5){syncPlacement();return;}
    manual=true;root.scale.setScalar(value);syncPlacement();onChange();
  });
  for(const key of ['x','y','z','yaw','scale'])$('#place-'+key).addEventListener('blur',syncPlacement);
  function edit(mode) {
    if(!root.visible)return;
    if(editing&&gizmo.mode===mode){stopEditing();return;}
    onEditStart();editing=true;gizmo.setMode(mode);gizmo.showX=mode==='translate';gizmo.showY=true;gizmo.showZ=mode==='translate';
    gizmo.attach(root);gizmo.enabled=true;gizmo.getHelper().visible=true;
    $('#placement-move').setAttribute('aria-pressed',String(mode==='translate'));
    $('#placement-rotate').setAttribute('aria-pressed',String(mode==='rotate'));
  }
  $('#placement-move').onclick=()=>edit('translate');$('#placement-rotate').onclick=()=>edit('rotate');
  $('#placement-done').onclick=stopEditing;
  $('#placement-reset').onclick=()=>{manual=false;automaticAnchor();syncPlacement();onChange();};
  gizmo.addEventListener('dragging-changed',event=>{controls.enabled=!event.value;});
  gizmo.addEventListener('objectChange',()=>{manual=true;syncPlacement();onChange();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')stopEditing();});
  return {
    get viewMode(){return view;},get enabled(){return enabled;},get visible(){return root.visible;},get editing(){return editing;},stopEditing,
    bounds(){return root.visible?new THREE.Box3().setFromObject(root):null;},
    setContext(bounds,key){
      scanBounds=bounds?.clone()||null;
      if(key!==contextKey){contextKey=key;manual=false;automaticAnchor();}
      if(model)rebuild();
    },
  };
}
