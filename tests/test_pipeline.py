import unittest, tempfile, json, os, time
from pathlib import Path
from unittest.mock import patch
import numpy as np
from scripts.demo_capture import make
from backend.capture import prepare, quaternion
from backend import main
from fastapi.testclient import TestClient

class CaptureTests(unittest.TestCase):
    def test_known_depth_and_pose(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);make(p);result=prepare(p)
            self.assertEqual(result['frames'],3)
            lines=(p/'cloud.ply').read_text().split('end_header\n')[1].splitlines()
            first=list(map(float,lines[0].split()[:3]))
            # At top-left pixel: x=-96/150*2, y=72/150*2 + camera height, z=-2.
            np.testing.assert_allclose(first,[-1.28,1.96,-2],atol=1e-6)
            cams=(p/'dataset'/'sparse'/'0'/'images.txt').read_text().splitlines()
            q=np.array(list(map(float,cams[0].split()[1:5])))
            np.testing.assert_allclose(abs(q),[0,1,0,0],atol=1e-6)
            T=json.loads((p/'dataset'/'transforms.json').read_text())['frames'][1]['transform_matrix']
            self.assertAlmostEqual(T[0][3],.1)
    def test_missing_depth_is_not_fake_geometry(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);make(p)
            for f in p.glob('*.depth'):f.unlink()
            with self.assertRaisesRegex(ValueError,'No usable LiDAR'):prepare(p)
    def test_wrong_depth_size_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);make(p);(p/'frame_000001.depth').write_bytes(b'bad')
            with self.assertRaises(ValueError):prepare(p)
    def test_api_upload_and_prepare(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as f:
            with patch.object(main,'DATA',Path(d)),patch.object(main,'TOKEN','test-token'):
                c=TestClient(main.app);self.assertEqual(c.post('/api/sessions').status_code,401)
                headers={'X-Capture-Token':'test-token'}
                sid=c.post('/api/sessions',headers=headers).json()['id'];make(Path(f))
                self.assertEqual(c.put(f'/api/sessions/{sid}/files/illegal.txt',headers=headers,content=b'x').status_code,400)
                for file in Path(f).iterdir():
                    r=c.put(f'/api/sessions/{sid}/files/{file.name}',headers=headers,content=file.read_bytes());self.assertEqual(r.status_code,200)
                self.assertEqual(c.post(f'/api/sessions/{sid}/prepare',headers=headers).status_code,200)
                for _ in range(100):
                    data=c.get('/api/sessions').json()[0]
                    if data['status'] in ['prepared','failed']:break
                    time.sleep(.03)
                self.assertEqual(data['status'],'prepared',data)
                self.assertEqual(c.get(data['cloud_url']).status_code,200)
                self.assertEqual(c.get(f'/api/sessions/{sid}/assets/session.json').status_code,404)
if __name__=='__main__':unittest.main()
