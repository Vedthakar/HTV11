import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.gaussian import train

class GaussianTests(unittest.TestCase):
    def test_point_cloud_only_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError,'camera poses'):train(Path(tmp),'brush')
    def test_success_publishes_scene_and_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'dataset').mkdir();(root/'dataset/transforms.json').write_text('{}')
            def run(cmd,**kwargs):
                output=Path(cmd[cmd.index('--export-path')+1]);(output/'scene.ply').write_bytes(b'gaussian-test')
                return type('Result',(),{'returncode':0})()
            with patch('backend.gaussian.subprocess.run',side_effect=run):train(root,'brush')
            self.assertEqual((root/'scene.ply').read_bytes(),b'gaussian-test')
            self.assertTrue((root/'train.log').exists())
    def test_failure_preserves_previous_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'dataset').mkdir();(root/'dataset/transforms.json').write_text('{}');(root/'scene.ply').write_bytes(b'old')
            with patch('backend.gaussian.subprocess.run',return_value=type('Result',(),{'returncode':1})()):
                with self.assertRaisesRegex(ValueError,'failed'):train(root,'brush')
            self.assertEqual((root/'scene.ply').read_bytes(),b'old')

    def test_training_endpoint_authorizes_and_queues(self):
        import json
        from fastapi.testclient import TestClient
        import backend.main as main
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);sid='a'*32;p=root/sid;p.mkdir();(p/'session.json').write_text(json.dumps({'id':sid,'status':'prepared'}))
            with patch.object(main,'DATA',root),patch.object(main,'TOKEN','test'),patch.object(main,'active',set()),patch.object(main.gaussian,'brush_binary',return_value='/test/brush'),patch.object(main.pool,'submit') as submit:
                client=TestClient(main.app)
                self.assertEqual(client.post(f'/api/sessions/{sid}/train').status_code,401)
                self.assertEqual(client.post(f'/api/sessions/{sid}/train',headers={'X-Capture-Token':'test'}).status_code,200)
                submit.assert_called_once_with(main.work,p,True)
                self.assertEqual(client.post(f'/api/sessions/{sid}/train',headers={'X-Capture-Token':'test'}).status_code,409)
