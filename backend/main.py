from pathlib import Path
from threading import Lock
from concurrent.futures import ThreadPoolExecutor
import json, os, re, secrets, shutil, time, uuid
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from .capture import prepare
from . import lota, live, gaussian

ROOT=Path(__file__).resolve().parents[1]
DATA=Path(os.environ.get('HTV_DATA_DIR',str(ROOT/'data'/'sessions')));DATA.mkdir(parents=True,exist_ok=True)
TOKEN=os.environ.get('HTV_CAPTURE_TOKEN','')
IMPORT_LIMIT=int(os.environ.get('HTV_IMPORT_MAX_MB','4096'))*1024*1024
app=FastAPI(title='HTV Rover Capture')
app.add_middleware(CORSMiddleware,allow_origins=['http://127.0.0.1:5175','http://localhost:5175'],allow_methods=['*'],allow_headers=['*'])
pool=ThreadPoolExecutor(max_workers=1); lock=Lock(); active=set()

def folder(sid):
    if not re.fullmatch(r'[a-f0-9]{32}',sid):raise HTTPException(404,'Unknown session')
    p=DATA/sid
    if not p.is_dir():raise HTTPException(404,'Unknown session')
    return p

def authorize(request):
    if TOKEN and not secrets.compare_digest(request.headers.get('X-Capture-Token',''),TOKEN):raise HTTPException(401,'Incorrect capture token')

def status(p,**updates):
    with lock:
        f=p/'session.json';s=json.loads(f.read_text());s.update(updates)
        temp=p/'session.tmp';temp.write_text(json.dumps(s,indent=2));temp.replace(f)

def public(p):
    s=json.loads((p/'session.json').read_text())
    if s.get('source')!='lota':s['frames']=len(list(p.glob('frame_*.json')))
    s['cloud_url']=f'/api/sessions/{p.name}/assets/cloud.ply' if (p/'cloud.ply').exists() else None
    s['splat_url']=f'/api/sessions/{p.name}/assets/scene.ply' if (p/'scene.ply').exists() else None
    s['trajectory_url']=f'/api/sessions/{p.name}/assets/trajectory.json' if (p/'trajectory.json').exists() else None
    return s

@app.get('/api/health')
def health():return {'ok':True,'capture_token_required':bool(TOKEN),'brush':bool(gaussian.brush_binary(ROOT))}

@app.get('/api/sessions')
def sessions():return [public(p) for p in sorted(DATA.iterdir(),reverse=True) if p.is_dir() and (p/'session.json').exists()]

@app.post('/api/sessions')
async def create(request:Request):
    authorize(request);sid=uuid.uuid4().hex;p=DATA/sid;p.mkdir();(p/'session.json').write_text(json.dumps({'id':sid,'created_at':time.time(),'status':'capturing','error':None}));return public(p)

@app.put('/api/sessions/{sid}/files/{name}')
async def upload(sid:str,name:str,request:Request):
    authorize(request);p=folder(sid)
    if not re.fullmatch(r'frame_\d{6}\.(jpg|json|depth|confidence)',name):raise HTTPException(400,'Invalid capture filename')
    if sid in active:raise HTTPException(409,'Session is being processed')
    temp=p/f'{name}.{uuid.uuid4().hex}.tmp';size=0
    try:
        with temp.open('wb') as f:
            async for chunk in request.stream():
                size+=len(chunk)
                if size>24*1024*1024:raise HTTPException(413,'File exceeds 24 MB')
                f.write(chunk)
        temp.replace(p/name)
    finally:temp.unlink(missing_ok=True)
    return {'bytes':size}

@app.get('/api/sessions/{sid}/assets/{name}')
def asset(sid:str,name:str):
    if name not in ['cloud.ply','trajectory.json','scene.ply','train.log']:raise HTTPException(404)
    p=folder(sid)/name
    if not p.is_file():raise HTTPException(404)
    return FileResponse(p)

def work(p,train=False):
    """Prepare geometry for a RoverCapture session (LOTA imports arrive already prepared)."""
    try:
        imported=json.loads((p/'session.json').read_text()).get('source')=='lota'
        if not imported:
            status(p,status='preparing',error=None);result=prepare(p);status(p,**result,status='prepared')
        if train:
            binary=gaussian.brush_binary(ROOT)
            if not binary:raise ValueError('Brush is not installed. Run python3 scripts/install_brush.py or set BRUSH_BIN.')
            status(p,status='training',error=None);gaussian.train(p,binary);status(p,status='ready',error=None)
    except Exception as e:status(p,status='failed',error=str(e))
    finally:
        with lock:active.discard(p.name)

def import_work(p):
    try:
        size=(p/'upload.zip').stat().st_size
        status(p,**lota.import_zip(p/'upload.zip',p,max_bytes=max(IMPORT_LIMIT*4,size)),status='prepared',error=None)
    except Exception as e:status(p,status='failed',error=str(e))
    finally:
        (p/'upload.zip').unlink(missing_ok=True)
        with lock:active.discard(p.name)

@app.post('/api/sessions/import')
async def import_capture(request:Request):
    """Upload a LOTA Gaussian Capture ZIP as the raw request body."""
    authorize(request);sid=uuid.uuid4().hex;p=DATA/sid;p.mkdir()
    name=re.sub(r'[^\w. ()-]','_',request.headers.get('X-Filename','LOTA capture'))[:120]
    (p/'session.json').write_text(json.dumps({'id':sid,'created_at':time.time(),'status':'uploading','source':'lota','name':name,'error':None}))
    size=0
    try:
        with (p/'upload.zip').open('wb') as f:
            async for chunk in request.stream():
                size+=len(chunk)
                if size>IMPORT_LIMIT:raise HTTPException(413,f'ZIP exceeds {IMPORT_LIMIT//2**20} MB (set HTV_IMPORT_MAX_MB)')
                f.write(chunk)
        if not size:raise HTTPException(400,'Empty upload')
    except BaseException:
        shutil.rmtree(p,ignore_errors=True);raise
    with lock:active.add(sid)
    status(p,status='importing');pool.submit(import_work,p);return public(p)

@app.post('/api/sessions/{sid}/prepare')
async def process(sid:str,request:Request):
    authorize(request);p=folder(sid)
    if json.loads((p/'session.json').read_text()).get('source')=='lota':raise HTTPException(409,'LOTA imports are already prepared')
    with lock:
        if active:raise HTTPException(409,'Another processing job is running; wait for it to finish')
        active.add(sid)
    pool.submit(work,p);return {'queued':True}

# Inspection records are kept apart from reconstruction state.
from .observations import create_router
app.include_router(create_router(folder, authorize))

@app.websocket('/api/live')
async def live_socket(ws:WebSocket):
    """Relay LOTA's live point stream and camera pose to the dashboard."""
    await ws.accept();await live.hub.start();queue=live.hub.subscribe()
    try:
        await ws.send_json(live.hub.status())
        while True:
            message=await queue.get()
            await (ws.send_bytes(message) if isinstance(message,bytes) else ws.send_json(message))
    except (WebSocketDisconnect,RuntimeError):pass
    finally:live.hub.unsubscribe(queue)


@app.post('/api/sessions/{sid}/train')
async def train_gaussians(sid:str,request:Request):
    authorize(request);p=folder(sid)
    if not gaussian.brush_binary(ROOT):raise HTTPException(503,'Brush is not installed. Install Brush or set BRUSH_BIN.')
    with lock:
        if active:raise HTTPException(409,'Another processing job is running; wait for it to finish')
        active.add(sid)
    status(p,status='queued',error=None)
    pool.submit(work,p,True)
    return {'queued':True}

from .building_scans import create_router as building_scans_router
app.include_router(building_scans_router(DATA, folder, authorize))
