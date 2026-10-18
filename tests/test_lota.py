import unittest, tempfile, json, struct, time, zipfile
from pathlib import Path
from unittest.mock import patch
import numpy as np
from fastapi.testclient import TestClient
from backend import lota, main
from scripts import make_lota_fixture as fixture


def imported(make, **kwargs):
    d = tempfile.TemporaryDirectory(); p = Path(d.name)
    make(p / 'in.zip', **kwargs); (p / 's').mkdir()
    return d, p / 's', lota.import_zip(p / 'in.zip', p / 's')


def expected_path():
    return [T[:3, 3] for i, T in enumerate(fixture.poses()) if i != fixture.SPIKE]


class LotaImportTests(unittest.TestCase):
    def test_nerfstudio_depth_nested_folder(self):
        d, s, r = imported(fixture.nerfstudio)
        with d:
            self.assertEqual((r['format'], r['frames'], r['dropped_frames'], r['demo']),
                             ('nerfstudio+depth', fixture.FRAMES - 1, 1, True))
            meta = json.loads((s / 'dataset' / 'transforms.json').read_text())
            self.assertEqual(len(meta['frames']), fixture.FRAMES - 1)
            self.assertTrue((s / 'transforms.original.json').is_file())
            np.testing.assert_allclose(json.loads((s / 'trajectory.json').read_text()), expected_path(), atol=1e-9)
            xyz, _ = lota.read_ply(s / 'cloud.ply')
            self.assertEqual(len(xyz), r['points']); self.assertLess(r['points'], r['raw_points'])
            self.assertFalse((s / 'lota_extract').exists())

    def test_colmap_poses_and_rewrite(self):
        d, s, r = imported(fixture.colmap)
        with d:
            self.assertEqual((r['format'], r['frames'], r['dropped_frames']), ('colmap', fixture.FRAMES - 1, 1))
            np.testing.assert_allclose(json.loads((s / 'trajectory.json').read_text()), expected_path(), atol=1e-9)
            images = lota.read_colmap_images(s / 'dataset' / 'sparse' / '0' / 'images.bin')
            self.assertEqual(len(images), fixture.FRAMES - 1)
            self.assertTrue((s / 'dataset' / 'images' / images[0][0]).is_file())

    def test_ply_only_and_ascii(self):
        d, s, r = imported(fixture.ply_only)
        with d:
            self.assertEqual(r['format'], 'ply')
            self.assertIn('Point cloud only', r['warnings'][0])
        d, s, r = imported(fixture.nerfstudio, depth=False, folder='', ascii_ply=True)
        with d:
            self.assertEqual(r['format'], 'nerfstudio'); self.assertGreater(r['points'], 1000)

    def test_unsafe_or_invalid_zips_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); (p / 's').mkdir()
            with zipfile.ZipFile(p / 'evil.zip', 'w') as z:
                z.writestr('../escape.txt', 'x')
            with self.assertRaisesRegex(ValueError, 'Unsafe path'):
                lota.import_zip(p / 'evil.zip', p / 's')
            self.assertFalse((p / 'escape.txt').exists())
            (p / 'bad.zip').write_bytes(b'not a zip')
            with self.assertRaisesRegex(ValueError, 'not a valid ZIP'):
                lota.import_zip(p / 'bad.zip', p / 's')
            with zipfile.ZipFile(p / 'empty.zip', 'w') as z:
                z.writestr('notes.txt', 'x')
            with self.assertRaisesRegex(ValueError, 'No LOTA export'):
                lota.import_zip(p / 'empty.zip', p / 's')
            fixture.nerfstudio(p / 'big.zip')
            with self.assertRaisesRegex(ValueError, 'size limit'):
                lota.import_zip(p / 'big.zip', p / 's', max_bytes=10_000)

    def test_permanent_jump_is_reported_not_dropped(self):
        path = [[0, 0, -0.05 * i] for i in range(10)] + [[2, 0, -0.05 * i] for i in range(10, 20)]
        drop, jumps = lota.pose_spikes(path)
        self.assertEqual((drop, jumps), (set(), [10]))

    def test_api_import_photos_and_prepare_guard(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as f:
            with patch.object(main, 'DATA', Path(d)), patch.object(main, 'TOKEN', 'test-token'):
                c = TestClient(main.app); headers = {'X-Capture-Token': 'test-token', 'X-Filename': 'scan.zip'}
                fixture.nerfstudio(Path(f) / 'n.zip'); fixture.ply_only(Path(f) / 'p.zip')
                self.assertEqual(c.post('/api/sessions/import', content=b'x').status_code, 401)

                def upload(name):
                    sid = c.post('/api/sessions/import', headers=headers, content=(Path(f) / name).read_bytes()).json()['id']
                    for _ in range(200):
                        s = next(s for s in c.get('/api/sessions').json() if s['id'] == sid)
                        if s['status'] in ('prepared', 'failed'):
                            return s
                        time.sleep(.03)
                    self.fail('import did not finish')

                s = upload('n.zip')
                self.assertEqual((s['status'], s['source'], s['frames'], s['name']), ('prepared', 'lota', fixture.FRAMES - 1, 'scan.zip'))
                self.assertEqual(c.get(s['cloud_url']).status_code, 200)
                photos = c.get(f"/api/sessions/{s['id']}/frames").json()
                self.assertEqual(len(photos), fixture.FRAMES)
                self.assertEqual(c.get(photos[0]['url']).headers['content-type'], 'image/jpeg')
                self.assertEqual(c.get(f"/api/sessions/{s['id']}/frames/..%2Fsession.json").status_code, 404)
                note = c.post(f"/api/sessions/{s['id']}/observations", headers=headers,
                              json={'position': {'x': 0, 'y': 0, 'z': 0}, 'title': 'Wall', 'sourceFrame': photos[0]['name']})
                self.assertEqual(note.status_code, 201)

                ply = upload('p.zip')
                self.assertEqual(ply['status'], 'prepared')
                # LOTA imports arrive prepared; re-running geometry preparation on them is refused.
                self.assertEqual(c.post(f"/api/sessions/{ply['id']}/prepare", headers=headers).status_code, 409)


if __name__ == '__main__':
    unittest.main()
