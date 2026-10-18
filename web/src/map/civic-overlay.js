import {addSurveyPlanner} from './survey-route.js';
import {createTileLoader,visibleTileKeys,MIN_CITY_ZOOM,MAX_VISIBLE_TILES} from '../city-tiles.js';
import {SCORE_COLOR,evaluationIndex,decorateBuildings,evaluationPoints} from '../city-evaluations.js';

export async function addCivicOverlay(map,onPick) {
  let destroyed=false,timer=null,manifest,evaluations,index,selected=null;
  const panel=document.createElement('section');panel.className='civic-panel card';panel.setAttribute('aria-label','Toronto building data');
  const heading=document.createElement('h2');heading.textContent='TORONTO / CIVIC DATA';
  const routeToggle=document.createElement('button');routeToggle.className='route-mode-toggle';routeToggle.textContent='Plan inspection route';routeToggle.type='button';
  const label=document.createElement('label');label.textContent='Building colours';
  const select=document.createElement('select');select.setAttribute('aria-label','Building colours');
  select.add(new Option('Apartment evaluation score','quality'));select.add(new Option('Derived building height','height'));label.append(select);
  const legend=document.createElement('p');legend.textContent='Scores: red → amber → green (0–100). Grey = no matched score. Not a safety rating.';
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Loading Toronto datasets…';
  const detail=document.createElement('div');detail.className='civic-detail';detail.textContent='Select a building to prepare its linked scans. Open Scan viewer when ready.';
  const attribution=document.createElement('a');attribution.href='https://open.toronto.ca/dataset/apartment-building-evaluation/';attribution.target='_blank';attribution.rel='noopener';attribution.textContent='City of Toronto · evaluation source ↗';
  panel.append(heading,routeToggle,label,legend,status,detail,attribution);map.getContainer().append(panel);
  let loader,cleanupPlanner;
  function pick(target,records,height) {
    detail.replaceChildren();
    const title=document.createElement('strong');title.textContent=target.label;detail.append(title);
    if(height){const p=document.createElement('p');p.textContent=`Derived height: ${height} m · not survey verified`;detail.append(p);}
    if(!records.length){const p=document.createElement('p');p.textContent='No matched apartment evaluation. Condition unknown.';detail.append(p);}
    for(const r of records){const p=document.createElement('p');p.textContent=`${r.address}: ${r.score??'Unknown'}/100 · ${r.date} · ${r.match}`;detail.append(p);}
    const note=document.createElement('p');note.textContent='Selected for Scan viewer. Location links are manual; spatial score matches are not address verified.';detail.append(note);
    onPick(target);
  }
  function paint() {
    const color=select.value==='quality'?['case',['!=',['get','evaluationScore'],null],SCORE_COLOR,'#8d999b']:['interpolate',['linear'],['get','height'],0,'#aaccc1',40,'#78a8b2',150,'#8f94bd',650,'#dcad74'];
    map.setPaintProperty('civic-buildings','fill-extrusion-color',['case',['boolean',['feature-state','selected'],false],'#f25c24',color]);
    map.setLayoutProperty('civic-evaluations','visibility',select.value==='quality'?'visible':'none');
  }
  function update() {
    if(destroyed)return;
    const b=map.getBounds(),keys=visibleTileKeys([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],manifest);
    if(map.getZoom()<MIN_CITY_ZOOM||keys.length>MAX_VISIBLE_TILES){loader.cancel();map.getSource('civic').setData({type:'FeatureCollection',features:[]});status.textContent='Zoom in for 3D building detail (14+). Evaluation dots remain available.';return;}
    loader.load(keys);
  }
  const move=()=>{clearTimeout(timer);loader?.cancel();};
  const end=()=>{clearTimeout(timer);timer=setTimeout(update,150);};
  try {
    const results=await Promise.all([fetch('/city/manifest.json'),fetch('/city/evaluations.json')]);
    if(results.some(r=>!r.ok))throw Error('Local city data is unavailable');
    [manifest,evaluations]=await Promise.all(results.map(r=>r.json()));if(destroyed)return;
    index=evaluationIndex(evaluations.records);
    // Render the supplied municipal footprints instead of duplicate basemap buildings.
    for(const layer of map.getStyle().layers)if(layer.type==='fill-extrusion')map.setLayoutProperty(layer.id,'visibility','none');
    map.addSource('civic',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'civic-buildings',type:'fill-extrusion',source:'civic',paint:{'fill-extrusion-height':['get','height'],'fill-extrusion-base':0,'fill-extrusion-opacity':.92}});
    map.addSource('civic-evaluations',{type:'geojson',data:evaluationPoints(evaluations.records)});
    map.addLayer({id:'civic-evaluations',type:'circle',source:'civic-evaluations',paint:{'circle-radius':5,'circle-stroke-width':1,'circle-stroke-color':'#fff','circle-color':['case',['!=',['get','evaluationScore'],null],SCORE_COLOR,'#8d999b']}});
    loader=createTileLoader({fetchTile:async(key,signal)=>{const r=await fetch(`/city/tiles/${key}.geojson`,{signal});if(!r.ok)throw Error(`Tile ${r.status}`);return r.json();},onData:data=>{selected=null;map.getSource('civic').setData(decorateBuildings(data,index));},onStatus:text=>{status.textContent=text;}});
    cleanupPlanner=addSurveyPlanner(map,evaluations.records,panel,onPick);
    const planner=panel.querySelector('.survey-planner');planner.hidden=true;
    routeToggle.onclick=()=>{const open=planner.hidden;planner.hidden=!open;for(const el of [label,legend,status,detail,attribution])el.hidden=open;routeToggle.textContent=open?'Back to building data':'Plan inspection route';};
    select.onchange=paint;paint();
    map.on('click','civic-buildings',event=>{
      if(map.queryRenderedFeatures(event.point,{layers:['civic-evaluations']}).length)return;
      const f=event.features?.[0];if(!f)return;
      if(selected!==null)map.removeFeatureState({source:'civic',id:selected});selected=f.id;map.setFeatureState({source:'civic',id:selected},{selected:true});
      const records=index.get(Number(f.id))||[];
      pick({key:`building:${f.id}`,label:records[0]?.address||`Building ${f.id}`},records,f.properties.height);
    });
    map.on('click','civic-evaluations',event=>{
      const f=event.features?.[0],r=evaluations.records.find(r=>r.id===f?.properties.recordId);if(!r)return;
      pick({key:r.buildingId!==null?`building:${r.buildingId}`:`evaluation:${r.id}`,label:r.address},[r]);
    });
    for(const layer of ['civic-buildings','civic-evaluations']){
      map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
    }
    map.on('movestart',move);map.on('moveend',end);update();
    map.getContainer().querySelector('.maplibregl-ctrl-attrib-inner')?.insertAdjacentHTML('beforeend',' · Contains information licensed under the Open Government Licence – Toronto');
  }catch(error){status.textContent=`Civic data: ${error.message}`;}
  return ()=>{destroyed=true;clearTimeout(timer);loader?.cancel();cleanupPlanner?.();map.off('movestart',move);map.off('moveend',end);panel.remove();};
}
