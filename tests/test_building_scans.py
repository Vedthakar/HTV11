import json
import tempfile
import unittest
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from backend.building_scans import create_router

class BuildingScanTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.sid='a'*32;(self.root/self.sid).mkdir()
        def folder(sid):
            if sid!=self.sid:raise HTTPException(404,'Unknown session')
            return self.root/sid
        def authorize(request):
            if request.headers.get('X-Capture-Token')!='test':raise HTTPException(401)
        self.folder=folder;self.authorize=authorize
        self.app=FastAPI();self.app.include_router(create_router(self.root,folder,authorize));self.client=TestClient(self.app)
        self.body={'target':'building:123','label':'Building 123','sessionId':self.sid}
        self.headers={'X-Capture-Token':'test'}
    def tearDown(self):self.temp.cleanup()
    def test_link_is_persistent_idempotent_and_filtered(self):
        for _ in range(2):self.assertEqual(self.client.post('/api/building-scans',json=self.body,headers=self.headers).status_code,200)
        app=FastAPI();app.include_router(create_router(self.root,self.folder,self.authorize))
        self.assertEqual(len(TestClient(app).get('/api/building-scans?target=building:123').json()),1)
        self.assertEqual(self.client.get('/api/building-scans?target=building:999').json(),[])
    def test_mutations_require_token_and_session(self):
        self.assertEqual(self.client.post('/api/building-scans',json=self.body).status_code,401)
        self.assertEqual(self.client.post('/api/building-scans',json={**self.body,'sessionId':'b'*32},headers=self.headers).status_code,404)
        self.assertEqual(self.client.post('/api/building-scans',json={**self.body,'target':'../bad'},headers=self.headers).status_code,422)
    def test_unlink_does_not_delete_capture_or_other_associations(self):
        for target in ['building:123','evaluation:456']:
            self.client.post('/api/building-scans',json={**self.body,'target':target},headers=self.headers)
        self.assertEqual(self.client.delete(f'/api/building-scans/building:123/{self.sid}').status_code,401)
        self.client.delete(f'/api/building-scans/building:123/{self.sid}',headers=self.headers)
        self.assertEqual(len(self.client.get('/api/building-scans').json()),1)
        self.assertTrue((self.root/self.sid).is_dir())
