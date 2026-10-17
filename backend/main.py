from pathlib import Path
from threading import Lock
from concurrent.futures import ThreadPoolExecutor
import json, os, re, secrets, shutil, subprocess, time, uuid
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from .capture import prepare

ROOT=Path(__file__).resolve().parents[1]
DATA=Path(os.environ.get('HTV_DATA_DIR',str(ROOT/'data'/'sessions')));DATA.mkdir(parents=True,exist_ok=True)
TOKEN=os.environ.get('HTV_CAPTURE_TOKEN','')
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
    s=json.loads((p/'session.json').read_text());s['frames']=len(list(p.glob('frame_*.json')))
    s['cloud_url']=f'/api/sessions/{p.name}/assets/cloud.ply' if (p/'cloud.ply').exists() else None
    s['splat_url']=f'/api/sessions/{p.name}/assets/scene.ply' if (p/'scene.ply').exists() else None
    return s

@app.get('/api/health')
def health():return {'ok':True,'brush':bool(shutil.which('brush') or shutil.which('brush_app') or (ROOT/'tools'/'brush_app').exists()),'capture_token_required':bool(TOKEN)}

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
    if name not in ['cloud.ply','scene.ply','trajectory.json','train.log']:raise HTTPException(404)
    p=folder(sid)/name
    if not p.is_file():raise HTTPException(404)
    return FileResponse(p)

def work(p,train):
    try:
        status(p,status='preparing',error=None);result=prepare(p);status(p,**result,status='prepared')
        if train:
            brush=os.environ.get('BRUSH_BIN') or shutil.which('brush') or shutil.which('brush_app') or str(ROOT/'tools'/'brush_app')
            if not Path(brush).is_file():raise ValueError('Brush is not installed. See README; geometry is available.')
            status(p,status='training');out=p/'trained';out.mkdir(exist_ok=True)
            cmd=[brush,str(p/'dataset'),'--total-steps','1500','--max-resolution','720','--export-every','1500','--export-path',str(out),'--export-name','scene.ply']
            with (p/'train.log').open('w') as log:
                proc=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,timeout=1800)
            if proc.returncode:raise ValueError('Brush failed. Read train.log for details.')
            matches=list(out.rglob('*.ply'))
            if not matches:raise ValueError('Brush returned no PLY. Check train.log.')
            shutil.copy2(max(matches,key=lambda f:f.stat().st_mtime),p/'scene.ply');status(p,status='ready')
    except Exception as e:status(p,status='failed',error=str(e))
    finally:
        with lock:active.discard(p.name)

@app.post('/api/sessions/{sid}/prepare')
async def process(sid:str,request:Request,train:bool=False):
    authorize(request);p=folder(sid)
    with lock:
        if active:raise HTTPException(409,'Another processing job is running; wait for it to finish')
        active.add(sid)
    pool.submit(work,p,train);return {'queued':True}

# Inspection records are kept apart from reconstruction/training state.
from .observations import create_router
app.include_router(create_router(folder, authorize))
