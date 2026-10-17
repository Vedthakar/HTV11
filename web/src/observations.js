// UI + API coordination. Every request is tied to a session to avoid cross-scan notes.
export function createObservations({pins, getToken, notice, showCloud}) {
  const $=s=>document.querySelector(s);
  const form=$('#observation-form'),list=$('#observation-list'),photo=$('#evidence-photo');
  let session=null,items=[],frames=[],editing=null,draft=null,revision=0,placing=false,available=false;
  let busy=false;
  async function api(path, options={}) {
    const res=await fetch(path,{...options,headers:{'Content-Type':'application/json','X-Capture-Token':getToken(),...options.headers}});
    const body=await res.json();
    if(!res.ok) throw Error(typeof body.detail==='string'?body.detail:'Invalid observation. Check the title, status, and source photo.');
    return body;
  }
  function mode(active) {placing=active;pins.setMode(active);$('#add-observation').textContent=active?'Cancel placement':'Add observation';}
  function close() {mode(false);editing=null;draft=null;form.hidden=true;pins.clearDraft();pins.select(null);}
  function preview() {
    const name=$('#observation-photo').value;
    photo.hidden=!name;photo.removeAttribute('src');$('#evidence-link').hidden=!name;
    if(name && session) {
      const url=`/api/sessions/${session.id}/frames/${encodeURIComponent(name)}`;
      photo.src=url;$('#evidence-link').href=url;
    }
  }
  function render() {
    list.replaceChildren();$('#observation-count').textContent=`${items.length} saved`;
    if(!items.length) {const p=document.createElement('p');p.className='note';p.textContent=session?'No observations yet. Place a pin on the point cloud.':'Select a saved session to add observations.';list.append(p);}
    for(const item of items) {
      const button=document.createElement('button');button.type='button';button.className='observation-item';
      const title=document.createElement('strong');title.textContent=item.title;
      const status=document.createElement('span');status.textContent={unreviewed:'Unreviewed',confirmed:'Confirmed observation',dismissed:'Dismissed'}[item.reviewStatus];
      button.append(title,status);button.onclick=()=>open(item.id);list.append(button);
    }
    pins.setItems(items);
  }
  function open(id) {
    const item=items.find(item=>item.id===id);if(!item)return;
    close();editing=item.id;pins.select(item.id);form.hidden=false;
    $('#observation-heading').textContent='Observation details';$('#observation-title').value=item.title;
    $('#observation-description').value=item.description;$('#observation-status').value=item.reviewStatus;
    $('#observation-photo').value=item.sourceFrame||'';
    $('#observation-position').textContent=`Scan coordinates: ${Object.values(item.position).map(v=>v.toFixed(3)).join(', ')}`;
    preview();$('#observation-title').focus();
  }
  function place(position) {
    mode(false);
    if(!position) {notice('No captured point at that location. Choose Add observation and click closer to the surface.');return;}
    draft=position;editing=null;form.reset();form.hidden=false;
    $('#observation-heading').textContent='New observation';
    $('#observation-position').textContent=`Scan coordinates: ${Object.values(position).map(v=>v.toFixed(3)).join(', ')}`;
    preview();$('#observation-title').focus();notice('Add a note and, optionally, select an original capture photo.');
  }
  $('#add-observation').onclick=()=>{
    if(placing) {close();return;}
    if(!available||!session)return;
    close();mode(true);notice('Click a captured surface to place a pin. Escape cancels.');
  };
  $('#show-cloud').onclick=()=>{close();showCloud();};
  $('#cancel-observation').onclick=close;
  $('#observation-photo').onchange=preview;
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){close();}});
  form.onsubmit=async event=>{
    event.preventDefault();if(!session||busy||(!editing&&!draft))return;
    const sid=session.id, rev=revision, id=editing;
    const body={title:$('#observation-title').value.trim(),description:$('#observation-description').value.trim(),reviewStatus:$('#observation-status').value,sourceFrame:$('#observation-photo').value||null};
    if(!body.title){$('#observation-title').focus();return;}
    if(!id)body.position=draft;
    busy=true;$('#save-observation').disabled=true;
    try {
      const result=await api(`/api/sessions/${sid}/observations${id?'/'+id:''}`,{method:id?'PATCH':'POST',body:JSON.stringify(body)});
      if(rev!==revision)return;
      if(id)items=items.map(item=>item.id===id?result:item);else items.push(result);
      close();render();notice('Observation saved to this scan.');
    } catch(error) {if(rev===revision)notice(error.message);}finally{busy=false;$('#save-observation').disabled=false;}
  };
  return {
    place,open,
    geometryReady(pointCloud) {available=Boolean(pointCloud&&session);pins.setCloud(pointCloud);$('#add-observation').disabled=!available;},
    async activate(next) {
      const rev=++revision;close();pins.reset();available=false;session=next;items=[];frames=[];render();
      $('#add-observation').disabled=true;$('#show-cloud').disabled=!next?.cloud_url;
      $('#observation-photo').replaceChildren(new Option('No source photo selected',''));
      if(!next)return;
      try {
        const [notes,photos]=await Promise.all([api(`/api/sessions/${next.id}/observations`),api(`/api/sessions/${next.id}/frames`)]);
        if(rev!==revision)return;items=notes;frames=photos;
        for(const frame of frames)$('#observation-photo').append(new Option(frame.name,frame.name));
        render();
      } catch(error) {if(rev===revision)notice(error.message);}
    },
    cancel:close
  };
}
