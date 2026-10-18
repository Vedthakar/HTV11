export function distance(a,b) {
  const rad=Math.PI/180,lat=(a[1]+b[1])*.5*rad;
  return Math.hypot((a[0]-b[0])*rad*Math.cos(lat),(a[1]-b[1])*rad)*6371000;
}
export function planStops(records,{start,bounds,maxScore=75,limit=8,radius=2000}) {
  const [w,s,e,n]=bounds,seen=new Set();
  const eligible=[...records].sort((a,b)=>(a.score??Infinity)-(b.score??Infinity)).filter(r=>{
    if(r.score===null||!Number.isFinite(r.score)||r.score>maxScore||!Number.isFinite(r.longitude)||!Number.isFinite(r.latitude))return false;
    const c=[r.longitude,r.latitude];if(c[0]<w||c[0]>e||c[1]<s||c[1]>n||distance(start,c)>radius)return false;
    const key=r.buildingId!==null?`b:${r.buildingId}`:`a:${r.address}`;
    if(seen.has(key))return false;seen.add(key);return true;
  }).sort((a,b)=>a.score-b.score||distance(start,[a.longitude,a.latitude])-distance(start,[b.longitude,b.latitude]));
  // Prioritize the lowest published scores; nearest-neighbour ordering is a heuristic, not a shortest-route guarantee.
  const pending=eligible.slice(0,limit),stops=[];let current=start;
  while(pending.length){let best=0;for(let i=1;i<pending.length;i++)if(distance(current,[pending[i].longitude,pending[i].latitude])<distance(current,[pending[best].longitude,pending[best].latitude]))best=i;const next=pending.splice(best,1)[0];stops.push(next);current=[next.longitude,next.latitude];}
  return {stops,eligibleCount:eligible.length};
}
export function addSurveyPlanner(map,records,panel,onPick) {
  const section=document.createElement('section');section.className='survey-planner';
  section.innerHTML='<h3>PLAN INSPECTION ROUTE</h3><label>Maximum evaluation score<input aria-label="Maximum evaluation score" type="number" min="0" max="100" value="75"></label><label>Maximum stops<input aria-label="Maximum stops" type="number" min="2" max="10" value="8"></label><label>Search radius (km)<input aria-label="Search radius in kilometres" type="number" min="0.2" max="5" step="0.1" value="2"></label><label><input type="checkbox" checked> Return to start</label><p>Start = map centre when planned. Selects lower-score apartments in the current view. This threshold is your filter, not an official safety category.</p><button type="button" class="plan-route">Plan survey route</button><button type="button" class="clear-route">Clear</button><button type="button" class="export-route" disabled>Export route GeoJSON</button><p class="route-status" role="status">No survey route planned.</p><ol class="route-stops"></ol><p>Pedestrian network proposal, not autonomous commands. Street snapping may be up to 100 m from a building. Entrances, stairs, access permission and rover clearance require review.</p><p>Routing: <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">FOSSGIS / OSRM</a> · <a href="https://www.openstreetmap.org/" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">Fix the map</a>. Planning sends public building coordinates and the map-centre start to this service.</p>';
  panel.insertBefore(section,panel.lastChild);
  const [scoreInput,limitInput,radiusInput,returnInput]=section.querySelectorAll('input');
  const button=section.querySelector('.plan-route'),clear=section.querySelector('.clear-route'),exportButton=section.querySelector('.export-route'),status=section.querySelector('.route-status'),list=section.querySelector('ol');
  let request=0,controller=null,output=null,lastRequest=0;
  const empty={type:'FeatureCollection',features:[]};
  map.addSource('survey-route',{type:'geojson',data:empty});
  map.addLayer({id:'survey-route-halo',type:'line',source:'survey-route',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#fff','line-width':7}});
  map.addLayer({id:'survey-route-line',type:'line',source:'survey-route',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#087e9b','line-width':4}});
  map.addLayer({id:'survey-route-stops',type:'circle',source:'survey-route',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':9,'circle-color':'#087e9b','circle-stroke-width':2,'circle-stroke-color':'#fff'}});
  const reset=()=>{window.dispatchEvent(new CustomEvent('rover:survey-cleared'));request++;controller?.abort();output=null;map.getSource('survey-route').setData(empty);list.replaceChildren();exportButton.disabled=true;button.disabled=false;};
  clear.onclick=()=>{reset();status.textContent='Survey route cleared.';};
  button.onclick=async()=>{
    const maxScore=Number(scoreInput.value),limit=Number(limitInput.value),radius=Number(radiusInput.value)*1000;
    if(!scoreInput.value||!limitInput.value||!radiusInput.value||maxScore<0||maxScore>100||!Number.isInteger(limit)||limit<2||limit>10||radius<200||radius>5000){status.textContent='Use a score 0–100, 2–10 stops and a radius 0.2–5 km.';return;}
    reset();const version=request,b=map.getBounds(),c=map.getCenter(),start=[c.lng,c.lat];
    const plan=planStops(records,{start,bounds:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],maxScore,limit,radius});
    if(plan.stops.length<2){status.textContent=`Found ${plan.stops.length} eligible stop(s). Pan to another area, zoom out, increase the radius or raise the score filter.`;return;}
    if(Date.now()-lastRequest<1100){status.textContent='Wait a moment before requesting another route.';return;}
    const coords=[start,...plan.stops.map(r=>[r.longitude,r.latitude]),...(returnInput.checked?[start]:[])];
    button.disabled=true;controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),25000);
    status.textContent=`Routing ${plan.stops.length} stops on the pedestrian network…`;
    try {
      lastRequest=Date.now();
      const url=`https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coords.map(c=>c.join(',')).join(';')}?overview=full&geometries=geojson&radiuses=${coords.map(()=>100).join(';')}`;
      const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error(`Routing service HTTP ${response.status}`);
      const body=await response.json();if(body.code!=='Ok'||!body.routes?.[0])throw Error(body.message||'No connected pedestrian route');
      if(version!==request)return;
      const route=body.routes[0];
      output={type:'FeatureCollection',features:[{type:'Feature',properties:{kind:'pedestrian-survey-proposal',distanceMetres:route.distance,maxScore,ordering:'lowest scores selected, nearest-neighbour heuristic',autonomous:false},geometry:route.geometry},
        {type:'Feature',properties:{kind:'start'},geometry:{type:'Point',coordinates:start}},...plan.stops.map((r,i)=>({type:'Feature',properties:{kind:'inspection-stop',stop:i+1,address:r.address,score:r.score,date:r.date,recordId:r.id,buildingId:r.buildingId},geometry:{type:'Point',coordinates:[r.longitude,r.latitude]}}))]};
      window.dispatchEvent(new CustomEvent('rover:survey-planned',{detail:{route,stops:plan.stops,waypoints:body.waypoints}}));
      map.getSource('survey-route').setData(output);exportButton.disabled=false;
      status.textContent=`${plan.stops.length} stops · ${(route.distance/1000).toFixed(2)} km pedestrian route · ${plan.eligibleCount} eligible locations. Survey simulation running on this route. Use Play/Pause, speed and timeline controls. Stops are simulated, not completed inspections.`;
      for(const [i,r] of plan.stops.entries()){
        const item=document.createElement('li'),pick=document.createElement('button');pick.textContent=`${i+1}. ${r.address} · ${r.score}/100`;
        pick.onclick=()=>onPick({key:r.buildingId!==null?`building:${r.buildingId}`:`evaluation:${r.id}`,label:r.address});item.append(pick);list.append(item);
      }
    }catch(error){if(version===request)status.textContent=`Route unavailable: ${error.name==='AbortError'?'request timed out':error.message}. No straight-line driving route has been substituted.`;}
    finally{clearTimeout(timeout);if(version===request)button.disabled=false;}
  };
  exportButton.onclick=()=>{if(!output)return;const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/geo+json'}));const a=document.createElement('a');a.href=url;a.download='proposed-survey-route.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return ()=>{reset();section.remove();};
}
