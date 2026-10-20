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
import {copyVertexColors, heightColorBuffer, pointWorldSize} from './cloud-view.js';
import {createMeasure} from './measure.js';

const $=s=>document.querySelector(s),viewport=$('#viewport');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));viewport.prepend(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(55,1,.01,1000);
camera.position.set(4,3,5);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
scene.add(new THREE.GridHelper(20,40,0x4a5157,0x2a2f34));
scene.add(new SparkRenderer({renderer}));
let content=null,selected=null,selectedSession=null,requestVersion=0,currentBounds=null;
let lastSessionSignature='';
let buildingTarget=null,buildingFilter=null,buildingLinks=[],buildingVersion=0;
let brushAvailable=false,pendingTrain=null;
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
    path.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xf25c24,depthTest:false,transparent:true})));
    for(const [point,color] of [[points[0],0x3fbf7f],[points.at(-1),0xf25c24]]){
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
let measuring=false;
const pins=createPins({scene,camera,canvas:renderer.domElement,controls,
  onPlace:position=>observations.place(position),onSelect:id=>observations.open(id),isVisible:point=>replacement?.isVisible(point)??true,isBlocked:()=>designer.editing||measuring});
const observations=createObservations({pins,getToken:()=>$('#token').value,notice,
  showCloud:()=>{if(selectedSession?.cloud_url)load(selectedSession.cloud_url,'cloud',selectedSession.demo);}});

const designer=createHouseDesigner({scene,camera,canvas:renderer.domElement,controls,onEditStart:()=>{observations.cancel();measure.stop();},onChange:()=>{$('#empty').hidden=Boolean(content)||designer.visible;replacement?.sync();},onFocus:houseOnly=>fit(houseOnly)});
const measure=createMeasure({scene,camera,canvas:renderer.domElement,getCloud:()=>content?.isPoints?content:null,isBlocked:()=>designer.editing,onActive(on){measuring=on;if(on){designer.stopEditing();observations.cancel();}}});
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
function applyCloudAppearance(points){
  if(!points?.isPoints)return;
  const scale=Number($('#point-size').value)/100;
  points.material.size=points.userData.basePointSize*(Number.isFinite(scale)?scale:1);
  const height=$('#color-by-height').checked;
  const colors=height?(points.userData.heightColors??=heightColorBuffer(points.userData.sourceGeometry.attributes.position.array,points.userData.sourceGeometry.attributes.position.count)):null;
  const geo=points.userData.sourceGeometry;
  if(height)geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
  else if(points.userData.capturedColors)geo.setAttribute('color',new THREE.BufferAttribute(points.userData.capturedColors,3));
  else geo.deleteAttribute('color');
  points.material.vertexColors=Boolean(height||points.userData.capturedColors);
  points.material.color.set(points.material.vertexColors?0xffffff:0xb7d6a3);
  points.material.needsUpdate=true;
  $('#point-size-value').textContent=`${Math.round((Number.isFinite(scale)?scale:1)*100)}%`;
}
function clear(){replacement.setSource(null);measure.setCloud(null);$('#cloud-view').hidden=true;if(content){scene.remove(content);dispose(content);content=null;}currentBounds=null;}
async function load(url,kind,demo=false,fileName){
  const version=++requestVersion;designer.stopEditing();observations.cancel();observations.geometryReady(null);notice('Loading reconstruction…');let obj;
  try{
    if(kind==='splat'){obj=new SplatMesh({url,fileName});obj.isSplatMesh=true;await obj.initialized;}
    else{
      const geo=await new PLYLoader().loadAsync(url);geo.computeBoundingBox();
      const diagonal=geo.boundingBox.getSize(new THREE.Vector3()).length();
      obj=new THREE.Points(geo,new THREE.PointsMaterial({size:pointWorldSize(diagonal),vertexColors:geo.hasAttribute('color'),color:geo.hasAttribute('color')?0xffffff:0xb7d6a3}));
      obj.userData.sourceGeometry=geo;obj.userData.basePointSize=pointWorldSize(diagonal);obj.userData.capturedColors=copyVertexColors(geo.getAttribute('color'));
    }
    if(version!==requestVersion){dispose(obj);return;}
    clear();content=obj;scene.add(obj);
    if(kind==='cloud')currentBounds=obj.geometry.boundingBox.clone();
    else{const bounds=obj.getBoundingBox?.();currentBounds=bounds&&!bounds.isEmpty()?bounds:new THREE.Box3(new THREE.Vector3(-2,-1,-2),new THREE.Vector3(2,2,2));}
    obj.userData.viewKey=selectedSession?.id||url;
    if(kind==='cloud')applyCloudAppearance(obj);
    designer.setContext(currentBounds,obj.userData.viewKey);replacement.setSource(obj,currentBounds,obj.userData.viewKey);
    if(kind==='cloud'){$('#cloud-view').hidden=false;measure.setCloud(obj);}
    else{$('#cloud-view').hidden=true;measure.setCloud(null);}
    fit();observations.geometryReady(kind==='cloud'?obj:null);
    $('#empty').hidden=true;
    $('#mode').textContent=demo?'SYNTHETIC TEST CAPTURE':kind==='cloud'?'LIDAR POINT CLOUD':'GAUSSIAN SPLAT';
    $('#metrics').textContent=kind==='cloud'?`${content.geometry.attributes.position.count.toLocaleString()} POINTS`:'GAUSSIAN SPLAT';
    notice(kind==='splat'?'Loaded. Open the point cloud to place observations.':'Loaded. Choose Add observation to pin a note to a captured point.');
  }catch(e){if(version===requestVersion){dispose(obj);notice(`Could not load: ${e.message}`);}}
}
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(viewport);
renderer.setAnimationLoop(()=>{controls.update();pins.update();measure.update();renderer.render(scene,camera);});
$('#fit').onclick=()=>fit();
$('#point-size').oninput=()=>{if(content?.isPoints)applyCloudAppearance(content);};
// The replacement preview works on a copy of the geometry, so re-sync it after recolouring.
$('#color-by-height').onchange=()=>{if(content?.isPoints){applyCloudAppearance(content);replacement.setSource(content,currentBounds,content.userData.viewKey);}};
$('#add-observation').addEventListener('click',()=>{designer.stopEditing();measure.stop();},true);

for(const kind of ['cloud','splat'])$('#'+kind).onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  ++requestVersion;clear();selected=null;selectedSession=null;
  $('#prepare').disabled=true;$('#train').disabled=true;$('#show-splat').disabled=true;clearPath();sessionInfo(null);
  await observations.activate(null);
  const url=URL.createObjectURL(file);await load(url,kind,false,file.name);URL.revokeObjectURL(url);e.target.value='';
  notice('Local file loaded. Select a saved session to create persistent observations.');
  lastSessionSignature='';refresh();
};
async function selectSession(s){
  ++requestVersion;clear();selected=s.id;selectedSession=s;
  $('#empty').hidden=designer.visible;$('#mode').textContent='LOADING SESSION';
  const imported=s.source==='lota';
  $('#prepare').hidden=imported;$('#prepare').disabled=false;
  $('#train').disabled=!brushAvailable||['capturing','uploading','importing','preparing','training','queued'].includes(s.status);
  $('#train').title=brushAvailable?'Prepare capture photos and train a Gaussian model':'Brush not installed on the backend';
  $('#show-splat').disabled=!s.splat_url;
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
    const health=await h.json();brushAvailable=Boolean(health.brush);
    $('#health').textContent=brushAvailable?'Server online · Brush ready':'Server online · Brush unavailable';$('#health').dataset.state='online';
    const r=await fetch('/api/sessions');if(!r.ok)throw Error('Session list unavailable');
    const sessions=await r.json();
    const trained=pendingTrain&&sessions.find(s=>s.id===pendingTrain&&['ready','failed'].includes(s.status));
    if(trained){pendingTrain=null;if(trained.status==='ready'&&selected===trained.id){await selectSession(trained);return;}notice(trained.error||'Gaussian training completed.');}
    const finished=pendingImport&&sessions.find(s=>s.id===pendingImport&&['prepared','failed'].includes(s.status));
    if(finished){
      pendingImport=null;
      if(finished.status==='failed')notice(`Import failed: ${finished.error}`);else if(buildingTarget){notice('Import finished. Attach it to this location, or choose Show all scans.');}else{notice('Import finished.');selectSession(finished);return;}
    }
    // Do not replace buttons every poll: preserve focus, and never reset an open note.
    const signature=JSON.stringify({sessions,selected,buildingFilter});
    if(signature===lastSessionSignature)return;lastSessionSignature=signature;
    $('#sessions').replaceChildren();
    updateBuildingControls(sessions);
    const shown=buildingFilter?sessions.filter(s=>buildingFilter.includes(s.id)):sessions;
    if(!shown.length){const p=document.createElement('p');p.className='muted';p.textContent=buildingTarget?'No scans linked to this location.':'No captures yet.';$('#sessions').append(p);}
    for(const s of shown){
      const button=document.createElement('button');button.className='session'+(selected===s.id?' selected':'');
      const name=document.createElement('span');name.className='session-name';
      name.textContent=s.name||new Date(s.created_at*1000).toLocaleString();
      const state=document.createElement('span');state.className='session-status';state.dataset.status=s.status;state.textContent=s.status;
      const detail=document.createElement('span');detail.className='session-meta';
      detail.textContent=[SOURCE_LABEL[s.source||'rover'],s.name?new Date(s.created_at*1000).toLocaleString():null,`${s.frames??0} frames`,s.demo?'SYNTHETIC TEST CAPTURE':null].filter(Boolean).join(' · ');
      button.append(name,state,detail);
      button.onclick=()=>selectSession(s);$('#sessions').append(button);
      if(selected===s.id){selectedSession=s;$('#show-cloud').disabled=!s.cloud_url;$('#show-splat').disabled=!s.splat_url;$('#train').disabled=!brushAvailable||['capturing','uploading','importing','preparing','training','queued'].includes(s.status);}
    }
  }catch(e){$('#health').textContent='Server offline';$('#health').dataset.state='offline';notice('Cannot reach backend. Start or restart it, then refresh.');}
}
$('#prepare').onclick=async()=>{
  if(!selected)return;
  try{
    const r=await fetch(`/api/sessions/${selected}/prepare`,{method:'POST',headers:{'X-Capture-Token':$('#token').value}});
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

$('#train').onclick=async()=>{
  if(!selected)return;
  const sid=selected;$('#train').disabled=true;
  try {
    const r=await fetch(`/api/sessions/${sid}/train`,{method:'POST',headers:{'X-Capture-Token':$('#token').value}});
    const body=await r.json();if(!r.ok)throw Error(body.detail||'Training request failed');
    pendingTrain=sid;notice('Gaussian training queued. This can take several minutes; the point cloud remains available.');lastSessionSignature='';await refresh();
  }catch(error){notice(error.message);$('#train').disabled=!brushAvailable;}
};
$('#show-splat').onclick=()=>{if(selectedSession?.splat_url)load(selectedSession.splat_url,'splat',selectedSession.demo);};

function resetScanDashboard() {
  ++requestVersion;designer.stopEditing();observations.cancel();clear();clearPath();sessionInfo(null);
  selected=null;selectedSession=null;
  if($('#house-enabled').checked)$('#house-enabled').click();
  observations.activate(null);
  $('#prepare').disabled=true;$('#train').disabled=true;$('#show-splat').disabled=true;$('#show-cloud').disabled=true;
  $('#empty h2').textContent='Ready for your first scan';$('#empty p').textContent='Record with RoverCapture or open a local reconstruction.';
  $('#empty').hidden=false;$('#mode').textContent='NO SCAN LOADED';$('#metrics').textContent='LOCAL WORKSPACE';
  lastSessionSignature='';
}
async function readBuildingLinks(target) {
  const response=await fetch(`/api/building-scans?target=${encodeURIComponent(target.key)}`);
  if(!response.ok)throw Error(response.status===404?'Restart the backend to enable saved building links.':'Could not read building links.');
  return response.json();
}
function updateBuildingControls(sessions) {
  $('#building-scan-context').hidden=!buildingTarget;if(!buildingTarget)return;
  $('#building-scan-label').textContent=buildingTarget.label;
  const available=buildingLinks.filter(link=>sessions.some(s=>s.id===link.sessionId));
  $('#building-scan-summary').textContent=available.length?`${available.length} linked scan(s). Showing this location’s captures.`:'No scans linked to this location.';
  if(!available.length&&!content){$('#empty h2').textContent='No scans linked';$('#empty p').textContent=`No scans have been attached to ${buildingTarget.label}. Use Show all scans to browse other captures.`;}
  const choice=$('#building-scan-choice'),previous=choice.value;
  choice.replaceChildren(new Option('Select a capture',''));
  for(const s of sessions)choice.add(new Option(`${new Date(s.created_at*1000).toLocaleString()} · ${s.frames} frames${s.demo?' · SYNTHETIC TEST':''}`,s.id));
  choice.value=sessions.some(s=>s.id===previous)?previous:'';
  const list=$('#building-linked-list');list.replaceChildren();
  for(const link of buildingLinks){
    const row=document.createElement('div');row.className='actions';
    const text=document.createElement('span');text.className='note';
    const session=sessions.find(s=>s.id===link.sessionId);
    text.textContent=session?`Linked: ${new Date(session.created_at*1000).toLocaleString()}${session.demo?' · SYNTHETIC TEST':''}`:'Linked capture no longer available';
    const remove=document.createElement('button');remove.textContent='Unlink capture';
    remove.onclick=()=>changeBuildingLink('DELETE',link.sessionId);
    row.append(text,remove);list.append(row);
  }
}
async function openBuilding(target) {
  $('#tab-scans').click();
  const version=++buildingVersion;buildingTarget=target;buildingFilter=[];buildingLinks=[];
  resetScanDashboard();
  $('#building-scan-context').hidden=false;$('#building-scan-label').textContent=target.label;
  $('#building-scan-summary').textContent='Looking for linked scans…';
  $('#building-scan-choice').replaceChildren(new Option('Select a capture',''));$('#building-linked-list').replaceChildren();
  try {
    const [links,r,h]=await Promise.all([readBuildingLinks(target),fetch('/api/sessions'),fetch('/api/health')]);
    if(!r.ok||!h.ok)throw Error('Could not load captures.');
    const [sessions,health]=await Promise.all([r.json(),h.json()]);
    if(version!==buildingVersion)return;
    buildingLinks=links;
    const linked=sessions.filter(s=>links.some(l=>l.sessionId===s.id));
    buildingFilter=linked.map(s=>s.id);
    lastSessionSignature='';await refresh();
    if(version!==buildingVersion)return;
    if(linked.length){const newest=linked.sort((a,b)=>b.created_at-a.created_at)[0];await selectSession(newest,health);}
    else notice('No scans linked to this location. Use Show all scans to browse other captures, or attach a capture here.');
  }catch(error){if(version===buildingVersion){lastSessionSignature='';await refresh();notice(error.message);}}
}
async function changeBuildingLink(method,sid) {
  if(!buildingTarget)return;
  const target=buildingTarget;
  if(!sid){notice('Choose a capture to attach.');return;}
  $('#building-scan-attach').disabled=true;
  try {
    const url=method==='POST'?'/api/building-scans':`/api/building-scans/${encodeURIComponent(target.key)}/${sid}`;
    const response=await fetch(url,{method,headers:{'Content-Type':'application/json','X-Capture-Token':$('#token').value},...(method==='POST'?{body:JSON.stringify({target:target.key,label:target.label,sessionId:sid})}:{})});
    if(!response.ok){let detail;try{detail=(await response.json()).detail;}catch{}throw Error(typeof detail==='string'?detail:'Could not save link. Check the capture token and backend.');}
    if(buildingTarget?.key===target.key)await openBuilding(target);
  }catch(error){notice(error.message);}finally{$('#building-scan-attach').disabled=false;}
}
$('#building-scan-attach').onclick=()=>changeBuildingLink('POST',$('#building-scan-choice').value);
$('#building-scan-all').onclick=()=>{++buildingVersion;buildingTarget=null;buildingFilter=null;buildingLinks=[];resetScanDashboard();$('#building-scan-context').hidden=true;refresh();notice('Showing all captures. Saved building links are unchanged.');};

if(new URLSearchParams(location.search).get('embedded')==='1') {
  document.body.classList.add('embedded-studio');
  $('#tab-scans').click();
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='rover:select-building')return;
    const target=event.data.target;
    if(target&&/^(building|evaluation):[0-9]{1,12}$/.test(target.key)&&typeof target.label==='string')openBuilding({key:target.key,label:target.label.slice(0,200)});
  });
}
