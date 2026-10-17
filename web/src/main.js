import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {SparkRenderer,SplatMesh} from '@sparkjsdev/spark';
const $=s=>document.querySelector(s),viewport=$('#viewport');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));viewport.prepend(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(55,1,.01,1000);camera.position.set(4,3,5);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
const grid=new THREE.GridHelper(20,40,0x647a70,0x354640);scene.add(grid);
const spark=new SparkRenderer({renderer});scene.add(spark);
let content=null,selected=null,loading=false,requestVersion=0,currentBounds=null;
function notice(message){$('#notice').textContent=message;}
function fit(){if(!currentBounds)return;const center=currentBounds.getCenter(new THREE.Vector3()),size=currentBounds.getSize(new THREE.Vector3()).length();controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(1,.65,1).normalize().multiplyScalar(Math.max(size,1)*1.25));camera.near=Math.max(size/10000,.005);camera.far=Math.max(size*30,100);camera.updateProjectionMatrix();controls.update();}
function clear(){if(content){scene.remove(content);if(content.isSplatMesh)content.dispose();else{content.geometry?.dispose();content.material?.dispose();}content=null;}}
async function load(url,kind,demo=false,fileName){const version=++requestVersion;loading=true;notice('Loading reconstruction…');let obj;
 try{if(kind==='splat'){obj=new SplatMesh({url,fileName});obj.isSplatMesh=true;await obj.initialized;}else{const geo=await new PLYLoader().loadAsync(url);geo.computeBoundingBox();obj=new THREE.Points(geo,new THREE.PointsMaterial({size:.022,vertexColors:geo.hasAttribute('color'),color:geo.hasAttribute('color')?0xffffff:0xb7d6a3}));}
 if(version!==requestVersion){obj.dispose?.();return;}clear();content=obj;scene.add(obj);
 if(kind==='cloud')currentBounds=obj.geometry.boundingBox.clone();else{const bounds=obj.getBoundingBox?.();currentBounds=bounds&&!bounds.isEmpty()?bounds:new THREE.Box3(new THREE.Vector3(-2,-1,-2),new THREE.Vector3(2,2,2));}
 fit();$('#empty').hidden=true;$('#mode').textContent=demo?'SYNTHETIC TEST CLOUD':kind==='cloud'?'LIDAR POINT CLOUD':'GAUSSIAN SPLAT';$('#metrics').textContent=kind==='cloud'?`${content.geometry.attributes.position.count.toLocaleString()} POINTS`:'TRAINED RECONSTRUCTION';notice('Loaded. Drag to explore.');
 }catch(e){notice(`Could not load: ${e.message}`);}finally{loading=false;}}
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}new ResizeObserver(resize).observe(viewport);renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
$('#fit').onclick=fit;
for(const kind of ['cloud','splat'])$('#'+kind).onchange=async e=>{const file=e.target.files[0];if(!file)return;const url=URL.createObjectURL(file);await load(url,kind,false,file.name);URL.revokeObjectURL(url);e.target.value='';};
async function refresh(){try{const h=await fetch('/api/health');if(!h.ok)throw Error('Server unavailable');const health=await h.json();$('#health').textContent=health.brush?'LAPTOP ONLINE · BRUSH READY':'LAPTOP ONLINE · BRUSH NOT INSTALLED';const r=await fetch('/api/sessions');if(!r.ok)throw Error('Session list unavailable');const sessions=await r.json();$('#sessions').replaceChildren();
 if(!sessions.length){const p=document.createElement('p');p.className='muted';p.textContent='No captures yet. Upload from your iPhone.';$('#sessions').append(p);}
 for(const s of sessions){const button=document.createElement('button');button.className='session'+(selected===s.id?' selected':'');button.textContent=new Date(s.created_at*1000).toLocaleString();const detail=document.createElement('span');detail.textContent=`${s.frames} frames · ${s.status}${s.demo?' · SYNTHETIC TEST CAPTURE':''}`;button.append(detail);button.onclick=()=>{selected=s.id;$('#prepare').disabled=false;$('#train').disabled=!health.brush;if(s.error)notice(s.error);else notice('Session selected. Prepare geometry or train a splat.');if(s.splat_url)load(s.splat_url,'splat',s.demo);else if(s.cloud_url)load(s.cloud_url,'cloud',s.demo);refresh();};$('#sessions').append(button);if(selected===s.id&&s.error)notice(s.error);}
 }catch(e){$('#health').textContent='LAPTOP SERVER OFFLINE';notice('Start the backend with npm run backend, then refresh.');}}
for(const action of ['prepare','train'])$('#'+action).onclick=async()=>{if(!selected)return;try{const r=await fetch(`/api/sessions/${selected}/prepare?train=${action==='train'}`,{method:'POST',headers:{'X-Capture-Token':$('#token').value}});const body=await r.json();if(!r.ok)throw Error(body.detail||'Request failed');notice('Queued. Session status updates automatically; select it again when complete to load the result.');await refresh();}catch(e){notice(e.message);}};
$('#refresh').onclick=refresh;refresh();setInterval(refresh,4000);
