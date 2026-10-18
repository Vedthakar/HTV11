"""Persistent explicit map-target to capture associations, independent of reconstruction."""
import json
import time
import uuid
from threading import Lock
from typing import Optional
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

class BuildingScanLink(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    target: str = Field(pattern=r'^(building|evaluation):[0-9]{1,12}$')
    label: str = Field(min_length=1, max_length=200)
    sessionId: str = Field(pattern=r'^[a-f0-9]{32}$')

def create_router(data, get_folder, authorize):
    router = APIRouter()
    lock = Lock()
    path = data / 'building-scans.json'
    def read():
        return json.loads(path.read_text()) if path.exists() else []
    def write(items):
        temp = path.with_name(f'building-scans-{uuid.uuid4().hex}.tmp')
        temp.write_text(json.dumps(items, indent=2))
        temp.replace(path)

    @router.get('/api/building-scans')
    def links(target: Optional[str] = None):
        with lock:
            return [item for item in read() if target is None or item['target'] == target]

    @router.post('/api/building-scans')
    def attach(body: BuildingScanLink, request: Request):
        authorize(request)
        get_folder(body.sessionId)
        with lock:
            items = read()
            existing = next((i for i in items if i['target'] == body.target and i['sessionId'] == body.sessionId), None)
            if existing:
                return existing
            item = dict(body.model_dump(), createdAt=time.time())
            items.append(item)
            write(items)
            return item

    @router.delete('/api/building-scans/{target}/{sid}')
    def detach(target: str, sid: str, request: Request):
        authorize(request)
        with lock:
            items = read()
            write([i for i in items if not (i['target'] == target and i['sessionId'] == sid)])
        return {'ok': True}
    return router
