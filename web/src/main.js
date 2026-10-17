import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {SparkRenderer,SplatMesh} from '@sparkjsdev/spark';
import {createPins} from './pins.js';
import {createObservations} from './observations.js';
import {createHouseDesigner} from './house.js';
import {createReplacement} from './replacement.js';
import {createLive} from './live.js';

const $=s=>document.querySelector(s),viewport=$('#viewport');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));viewport.prepend(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(55,1,.01,1000);
camera.position.set(4,3,5);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
scene.add(new THREE.GridHelper(20,40,0x647a70,0x354640));
scene.add(new SparkRenderer({renderer}));
let content=null,selected=null,selectedSession=null,requestVersion=0,currentBounds=null;
let lastSessionSignature='';
let replacement=null;
let pendingImport=null;
const SOURCE_LABEL={lota:'LOTA',rover:'RoverCapture'};

// Rover/camera path from trajectory.json: a line plus start (green) and end (amber) markers.
const path=new THREE.Group();path.renderOrder=2;scene.add(path);
function clearPath(){
  for(const child of [...path.children]){path.remove(child);child.geometry.dispose();child.material.dispose();}
  $('#show-path').disabled=true;
}
async function loadPath(url){
  clearPath();if(!url)return;
  try{
    const points=(await (await fetch(url)).json()).map(p=>new THREE.Vector3(...p));
    if(points.length<2)return;
    path.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xf2b84b,depthTest:false,transparent:true})));
    for(const [point,color] of [[points[0],0x8fd694],[points.at(-1),0xf2b84b]]){
      const marker=new THREE.Mesh(new THREE.SphereGeometry(.05,16,12),new THREE.MeshBasicMaterial({color,depthTest:false,transparent:true}));
      marker.position.copy(point);path.add(marker);
    }
    $('#show-path').disabled=false;path.visible=$('#show-path').checked;
  }catch{/* The scan is still usable without its path. */}
}
$('#show-path').onchange=e=>{path.visible=e.target.checked;};
function sessionInfo(s){
  const box=$('#session-info');box.replaceChildren();
  const lines=[...(s?.warnings||[])];
  if(s?.source==='lota')lines.unshift(`LOTA ${s.format||'export'} · ${s.frames??0} frames · ${(s.points??0).toLocaleString()} points${s.dropped_frames?` · ${s.dropped_frames} jolt frame(s) removed`:''}`);
  for(const line of lines){const p=document.createElement('p');p.textContent=line;box.append(p);}
}
function notice(message){$('#notice').textContent=message;}
const pins=createPins({scene,camera,canvas:renderer.domElement,controls,
  onPlace:position=>observations.place(position),onSelect:id=>observations.open(id),isVisible:point=>replacement?.isVisible(point)??true,isBlocked:()=>designer.editing});
const observations=createObservations({pins,getToken:()=>$('#token').value,notice,
  showCloud:()=>{if(selectedSession?.cloud_url)load(selectedSession.cloud_url,'cloud',selectedSession.demo);}});

const designer=createHouseDesigner({scene,camera,canvas:renderer.domElement,controls,onEditStart:()=>observations.cancel(),onChange:()=>{$('#empty').hidden=Boolean(content)||designer.visible;replacement?.sync();},onFocus:houseOnly=>fit(houseOnly)});
replacement=createReplacement({scene,getView:()=>designer.viewMode,getProposalEnabled:()=>designer.enabled,getHouseBounds:()=>designer.bounds()});
function fit(houseOnly=false){
  const houseBounds=designer.bounds();
  let bounds=houseOnly&&houseBounds?houseBounds:currentBounds?.clone();
  if(!houseOnly&&houseBounds)bounds=bounds?bounds.union(houseBounds):houseBounds;
  fitBox(bounds);
}
function fitBox(bounds){
  if(!bounds||bounds.isEmpty())return;
  const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()).length();
  controls.target.copy(center);
  const vertical=THREE.MathUtils.degToRad(camera.fov/2);
  const horizontal=Math.atan(Math.tan(vertical)*camera.aspect);
  const distance=Math.max(size,1)*.5/Math.sin(Math.min(vertical,horizontal))*1.12;
  camera.position.copy(center).add(new THREE.Vector3(1,.65,1).normalize().multiplyScalar(distance));
  camera.near=Math.max(size/10000,.005);camera.far=Math.max(size*30,100);camera.updateProjectionMatrix();controls.update();
}
createLive({scene,notice,fitBox});
function dispose(obj){
  if(!obj)return;
  if(obj.isSplatMesh)obj.dispose();else{obj.geometry?.dispose();obj.material?.dispose();}
}
function clear(){replacement.setSource(null);if(content){scene.remove(content);dispose(content);content=null;}currentBounds=null;}
async function load(url,kind,demo=false,fileName){
  const version=++requestVersion;designer.stopEditing();observations.cancel();observations.geometryReady(null);notice('Loading reconstruction…');let obj;
  try{
    if(kind==='splat'){obj=new SplatMesh({url,fileName});obj.isSplatMesh=true;await obj.initialized;}
    else{
      const geo=await new PLYLoader().loadAsync(url);geo.computeBoundingBox();
      obj=new THREE.Points(geo,new THREE.PointsMaterial({size:.022,vertexColors:geo.hasAttribute('color'),color:geo.hasAttribute('color')?0xffffff:0xb7d6a3}));
    }
    if(version!==requestVersion){dispose(obj);return;}
    clear();content=obj;scene.add(obj);
    if(kind==='cloud')currentBounds=obj.geometry.boundingBox.clone();
    else{const bounds=obj.getBoundingBox?.();currentBounds=bounds&&!bounds.isEmpty()?bounds:new THREE.Box3(new THREE.Vector3(-2,-1,-2),new THREE.Vector3(2,2,2));}
    designer.setContext(currentBounds,selectedSession?.id||url);replacement.setSource(obj,currentBounds,selectedSession?.id||url);fit();observations.geometryReady(kind==='cloud'?obj:null);
    $('#empty').hidden=true;
    $('#mode').textContent=demo?'SYNTHETIC TEST CAPTURE':kind==='cloud'?'LIDAR POINT CLOUD':'GAUSSIAN SPLAT';
    $('#metrics').textContent=kind==='cloud'?`${content.geometry.attributes.position.count.toLocaleString()} POINTS`:'TRAINED RECONSTRUCTION';
    notice(kind==='splat'?'Loaded. Open the point cloud to place observations.':'Loaded. Choose Add observation to pin a note to a captured point.');
  }catch(e){if(version===requestVersion){dispose(obj);notice(`Could not load: ${e.message}`);}}
}
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(viewport);
renderer.setAnimationLoop(()=>{controls.update();pins.update();renderer.render(scene,camera);});
$('#fit').onclick=()=>fit();
$('#add-observation').addEventListener('click',()=>designer.stopEditing(),true);

for(const kind of ['cloud','splat'])$('#'+kind).onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  ++requestVersion;clear();selected=null;selectedSession=null;
  $('#prepare').disabled=true;$('#train').disabled=true;clearPath();sessionInfo(null);
  await observations.activate(null);
  const url=URL.createObjectURL(file);await load(url,kind,false,file.name);URL.revokeObjectURL(url);e.target.value='';
  notice('Local file loaded. Select a saved session to create persistent observations.');
  lastSessionSignature='';refresh();
};
async function selectSession(s,health){
  ++requestVersion;clear();selected=s.id;selectedSession=s;
  $('#empty').hidden=designer.visible;$('#mode').textContent='LOADING SESSION';
  const imported=s.source==='lota';
  $('#prepare').hidden=imported;$('#prepare').disabled=false;
  $('#train').disabled=!health.brush||s.trainable===false;
  sessionInfo(s);
  const notes=observations.activate(s);
  if(s.splat_url)await load(s.splat_url,'splat',s.demo);
  else if(s.cloud_url)await load(s.cloud_url,'cloud',s.demo);
  else notice(imported?`Import ${s.status}. It opens automatically when ready.`:'Prepare geometry to load this capture and place observations.');
  if(selected===s.id)await loadPath(s.trajectory_url);
  await notes;
  if(selected!==s.id)return;
  if(s.error)notice(s.error);
  lastSessionSignature='';refresh();
}
async function refresh(){
  try{
    const h=await fetch('/api/health');if(!h.ok)throw Error('Server unavailable');
    const health=await h.json();$('#health').textContent=health.brush?'LAPTOP ONLINE · BRUSH INSTALLED':'LAPTOP ONLINE · BRUSH NOT INSTALLED';
    const r=await fetch('/api/sessions');if(!r.ok)throw Error('Session list unavailable');
    const sessions=await r.json();
    const finished=pendingImport&&sessions.find(s=>s.id===pendingImport&&['prepared','failed'].includes(s.status));
    if(finished){
      pendingImport=null;
      if(finished.status==='failed')notice(`Import failed: ${finished.error}`);else{notice('Import finished.');selectSession(finished,health);return;}
    }
    // Do not replace buttons every poll: preserve focus, and never reset an open note.
    const signature=JSON.stringify({sessions,selected});
    if(signature===lastSessionSignature)return;lastSessionSignature=signature;
    $('#sessions').replaceChildren();
    if(!sessions.length){const p=document.createElement('p');p.className='muted';p.textContent='No captures yet. Import a LOTA capture below.';$('#sessions').append(p);}
    for(const s of sessions){
      const button=document.createElement('button');button.className='session'+(selected===s.id?' selected':'');
      button.textContent=s.name||new Date(s.created_at*1000).toLocaleString();
      const detail=document.createElement('span');
      detail.textContent=[SOURCE_LABEL[s.source||'rover'],s.name?new Date(s.created_at*1000).toLocaleString():null,`${s.frames??0} frames`,s.status,s.demo?'SYNTHETIC TEST CAPTURE':null].filter(Boolean).join(' · ');
      button.append(detail);
      button.onclick=()=>selectSession(s,health);$('#sessions').append(button);
      if(selected===s.id){selectedSession=s;$('#show-cloud').disabled=!s.cloud_url;}
    }
  }catch(e){$('#health').textContent='LAPTOP SERVER OFFLINE';notice('Cannot reach backend. Start or restart it, then refresh.');}
}
for(const action of ['prepare','train'])$('#'+action).onclick=async()=>{
  if(!selected)return;
  try{
    const r=await fetch(`/api/sessions/${selected}/prepare?train=${action==='train'}`,{method:'POST',headers:{'X-Capture-Token':$('#token').value}});
    const body=await r.json();if(!r.ok)throw Error(body.detail||'Request failed');
    notice('Queued. Status updates automatically; select the session again when complete to load the result.');await refresh();
  }catch(e){notice(e.message);}
};
// LOTA ZIP import: XHR rather than fetch so upload progress can be shown.
function importZip(file){
  if(!file)return;
  if(!/\.zip$/i.test(file.name)){notice('Choose the LOTA_*.zip exported from the app.');return;}
  const xhr=new XMLHttpRequest(),bar=$('#import-progress');
  xhr.open('POST','/api/sessions/import');
  xhr.setRequestHeader('X-Capture-Token',$('#token').value);xhr.setRequestHeader('X-Filename',file.name);
  xhr.upload.onprogress=e=>{if(e.lengthComputable){bar.value=e.loaded/e.total;notice(`Uploading ${file.name}: ${Math.round(100*e.loaded/e.total)}%`);}};
  xhr.onload=()=>{
    bar.hidden=true;let body={};try{body=JSON.parse(xhr.responseText);}catch{}
    if(xhr.status>=300){notice(`Import failed: ${body.detail||xhr.statusText}`);return;}
    pendingImport=body.id;notice('Uploaded. Building the map…');lastSessionSignature='';refresh();
  };
  xhr.onerror=()=>{bar.hidden=true;notice('Upload failed. Is the backend running?');};
  bar.value=0;bar.hidden=false;xhr.send(file);
}
$('#import').onchange=e=>{importZip(e.target.files[0]);e.target.value='';};
let dragDepth=0;
addEventListener('dragenter',e=>{if(e.dataTransfer?.types.includes('Files')){dragDepth++;document.body.classList.add('dropping');}});
addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('dropping');}});
addEventListener('dragover',e=>e.preventDefault());
addEventListener('drop',e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('dropping');importZip(e.dataTransfer.files[0]);});
$('#refresh').onclick=refresh;observations.activate(null);refresh();setInterval(refresh,4000);
