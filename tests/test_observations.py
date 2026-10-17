import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import main
from backend.observations import create_router

class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.patch_data=patch.object(main,'DATA',Path(self.temp.name));self.patch_data.start();self.addCleanup(self.patch_data.stop)
        self.patch_token=patch.object(main,'TOKEN','notes-token');self.patch_token.start();self.addCleanup(self.patch_token.stop)
        self.client=TestClient(main.app);self.headers={'X-Capture-Token':'notes-token'}
        self.sid=self.client.post('/api/sessions',headers=self.headers).json()['id']
        self.base=f'/api/sessions/{self.sid}'
    def payload(self):
        return {'title':' Window corner ','description':'Review this surface','position':{'x':1,'y':2,'z':-3}}
    def test_create_patch_and_persistence(self):
        r=self.client.post(self.base+'/observations',json=self.payload(),headers=self.headers)
        self.assertEqual(r.status_code,201,r.text);item=r.json();self.assertEqual(item['title'],'Window corner')
        r=self.client.patch(self.base+'/observations/'+item['id'],headers=self.headers,json={'reviewStatus':'confirmed','description':'Reviewed original photo'})
        self.assertEqual(r.status_code,200);self.assertEqual(r.json()['position'],item['position'])
        saved=json.loads((Path(self.temp.name)/self.sid/'observations.json').read_text())
        self.assertEqual(saved[0]['reviewStatus'],'confirmed')
        # A fresh application/router reads the disk record, not in-memory data.
        from fastapi import FastAPI
        fresh=FastAPI();fresh.include_router(create_router(main.folder,main.authorize))
        self.assertEqual(TestClient(fresh).get(self.base+'/observations').json(),saved)
    def test_authorization_and_validation(self):
        self.assertEqual(self.client.post(self.base+'/observations',json=self.payload()).status_code,401)
        for update in [{'title':'   '},{'position':{'x':1e20,'y':0,'z':0}},{'reviewStatus':'safe'},{'unexpected':'value'}]:
            body=self.payload();body.update(update)
            self.assertEqual(self.client.post(self.base+'/observations',headers=self.headers,json=body).status_code,422)
        r=self.client.post(self.base+'/observations',headers=self.headers,json=self.payload());oid=r.json()['id']
        self.assertEqual(self.client.patch(self.base+'/observations/'+oid,headers=self.headers,json={'title':None}).status_code,422)
    def test_source_photo_must_belong_to_session(self):
        body=self.payload();body['sourceFrame']='frame_000001.jpg'
        self.assertEqual(self.client.post(self.base+'/observations',headers=self.headers,json=body).status_code,422)
        self.client.put(self.base+'/files/frame_000001.jpg',headers=self.headers,content=b'test-photo')
        r=self.client.post(self.base+'/observations',headers=self.headers,json=body)
        self.assertEqual(r.status_code,201)
        frames=self.client.get(self.base+'/frames').json();self.assertEqual(len(frames),1)
        self.assertEqual(self.client.get(frames[0]['url']).content,b'test-photo')
        self.assertEqual(self.client.get(self.base+'/frames/session.json').status_code,404)
        body['sourceFrame']='../session.json'
        self.assertEqual(self.client.post(self.base+'/observations',headers=self.headers,json=body).status_code,422)
    def test_other_session_cannot_edit_observation(self):
        item=self.client.post(self.base+'/observations',headers=self.headers,json=self.payload()).json()
        other=self.client.post('/api/sessions',headers=self.headers).json()['id']
        r=self.client.patch(f'/api/sessions/{other}/observations/{item["id"]}',headers=self.headers,json={'title':'Wrong session'})
        self.assertEqual(r.status_code,404)
        self.assertEqual(self.client.get(f'/api/sessions/{other}/observations').json(),[])
