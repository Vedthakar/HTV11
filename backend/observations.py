"""Validated per-session inspection notes. Source photos remain original captures."""
import json
import re
import time
import uuid
from pathlib import Path
from threading import Lock
from typing import Literal, Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

ReviewStatus = Literal['unreviewed', 'confirmed', 'dismissed']
FRAME_NAME = re.compile(r'frame_\d{6}\.jpg')
IMPORTED_NAME = re.compile(r'[\w.-]{1,128}\.(jpe?g|png)', re.IGNORECASE)


def photo_dir(p):
    """RoverCapture keeps frames in the session folder; LOTA imports keep them in dataset/images."""
    session = p / 'session.json'
    imported = session.exists() and json.loads(session.read_text()).get('source') == 'lota'
    return (p / 'dataset' / 'images', IMPORTED_NAME) if imported else (p, FRAME_NAME)


def photo_path(p, name):
    folder, pattern = photo_dir(p)
    path = folder / name
    return path if pattern.fullmatch(name) and path.is_file() else None

class Position(BaseModel):
    model_config = ConfigDict(extra='forbid')
    x: float = Field(ge=-1e6, le=1e6, allow_inf_nan=False)
    y: float = Field(ge=-1e6, le=1e6, allow_inf_nan=False)
    z: float = Field(ge=-1e6, le=1e6, allow_inf_nan=False)

class ObservationCreate(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    position: Position
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default='', max_length=4000)
    reviewStatus: ReviewStatus = 'unreviewed'
    sourceFrame: Optional[str] = None

class ObservationPatch(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=4000)
    reviewStatus: Optional[ReviewStatus] = None
    sourceFrame: Optional[str] = None


def create_router(get_folder, authorize):
    router = APIRouter()
    storage_lock = Lock()

    def read(p):
        file = p / 'observations.json'
        return json.loads(file.read_text()) if file.exists() else []

    def write(p, items):
        dest = p / 'observations.json'
        temp = p / f'observations-{uuid.uuid4().hex}.tmp'
        temp.write_text(json.dumps(items, indent=2, allow_nan=False))
        temp.replace(dest)

    def validate_frame(p, name):
        if name is not None and photo_path(p, name) is None:
            raise HTTPException(422, 'Source photo must be an original frame from this session')

    @router.get('/api/sessions/{sid}/observations')
    def list_observations(sid: str):
        p = get_folder(sid)
        with storage_lock:
            return read(p)

    @router.post('/api/sessions/{sid}/observations', status_code=201)
    def add_observation(sid: str, body: ObservationCreate, request: Request):
        authorize(request)
        p = get_folder(sid)
        validate_frame(p, body.sourceFrame)
        now = time.time()
        item = dict(body.model_dump(), id=uuid.uuid4().hex, scanId=sid, createdAt=now, updatedAt=now)
        with storage_lock:
            items = read(p)
            items.append(item)
            write(p, items)
        return item

    @router.patch('/api/sessions/{sid}/observations/{oid}')
    def edit_observation(sid: str, oid: str, body: ObservationPatch, request: Request):
        authorize(request)
        p = get_folder(sid)
        updates = body.model_dump(exclude_unset=True)
        if any(value is None and key != 'sourceFrame' for key, value in updates.items()):
            raise HTTPException(422, 'Only sourceFrame may be null')
        if 'sourceFrame' in updates:
            validate_frame(p, updates['sourceFrame'])
        with storage_lock:
            items = read(p)
            item = next((item for item in items if item['id'] == oid), None)
            if item is None:
                raise HTTPException(404, 'Observation not found in this session')
            item.update(updates, updatedAt=time.time())
            write(p, items)
        return item

    @router.get('/api/sessions/{sid}/frames')
    def frames(sid: str):
        p = get_folder(sid)
        folder, pattern = photo_dir(p)
        files = sorted(folder.iterdir(), key=lambda f: f.name) if folder.is_dir() else []
        return [{'name': f.name, 'url': f'/api/sessions/{sid}/frames/{f.name}'}
                for f in files if f.is_file() and pattern.fullmatch(f.name)]

    @router.get('/api/sessions/{sid}/frames/{name}')
    def frame(sid: str, name: str):
        p = get_folder(sid)
        path = photo_path(p, name)
        if path is None:
            raise HTTPException(404, 'Source photo not found')
        media = 'image/png' if path.suffix.lower() == '.png' else 'image/jpeg'
        return FileResponse(path, media_type=media, headers={'Cache-Control': 'private, max-age=3600'})

    return router
