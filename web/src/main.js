import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {SparkRenderer,SplatMesh} from '@sparkjsdev/spark';
import {createPins} from './pins.js';
import {createObservations} from './observations.js';
import {createHouseDesigner} from './house.js';
import {createReplacement} from './replacement.js';

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
  if(!bounds)return;
  const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()).length();
  controls.target.copy(center);
  const vertical=THREE.MathUtils.degToRad(camera.fov/2);
  const horizontal=Math.atan(Math.tan(vertical)*camera.aspect);
  const distance=Math.max(size,1)*.5/Math.sin(Math.min(vertical,horizontal))*1.12;
  camera.position.copy(center).add(new THREE.Vector3(1,.65,1).normalize().multiplyScalar(distance));
  camera.near=Math.max(size/10000,.005);camera.far=Math.max(size*30,100);camera.updateProjectionMatrix();controls.update();
}
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
  $('#prepare').disabled=true;$('#train').disabled=true;
  await observations.activate(null);
  const url=URL.createObjectURL(file);await load(url,kind,false,file.name);URL.revokeObjectURL(url);e.target.value='';
  notice('Local file loaded. Select a saved session to create persistent observations.');
  lastSessionSignature='';refresh();
};
async function selectSession(s,health){
  ++requestVersion;clear();selected=s.id;selectedSession=s;
  $('#empty').hidden=designer.visible;$('#mode').textContent='LOADING SESSION';
  $('#prepare').disabled=false;$('#train').disabled=!health.brush;
  const notes=observations.activate(s);
  if(s.splat_url)await load(s.splat_url,'splat',s.demo);
  else if(s.cloud_url)await load(s.cloud_url,'cloud',s.demo);
  else notice('Prepare geometry to load this capture and place observations.');
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
    // Do not replace buttons every poll: preserve focus, and never reset an open note.
    const signature=JSON.stringify({sessions,selected});
    if(signature===lastSessionSignature)return;lastSessionSignature=signature;
    $('#sessions').replaceChildren();
    if(!sessions.length){const p=document.createElement('p');p.className='muted';p.textContent='No captures yet. Upload from your iPhone.';$('#sessions').append(p);}
    for(const s of sessions){
      const button=document.createElement('button');button.className='session'+(selected===s.id?' selected':'');button.textContent=new Date(s.created_at*1000).toLocaleString();
      const detail=document.createElement('span');detail.textContent=`${s.frames} frames · ${s.status}${s.demo?' · SYNTHETIC TEST CAPTURE':''}`;button.append(detail);
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
$('#refresh').onclick=refresh;observations.activate(null);refresh();setInterval(refresh,4000);
