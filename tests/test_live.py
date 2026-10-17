import unittest, asyncio, struct
import numpy as np
from backend import live
from scripts.simulate_lota_stream import osc


class LiveTests(unittest.TestCase):
    def test_osc_messages_and_bundles(self):
        position = osc('/lota/camera/position', 1.5, 0.3, -2.0)
        self.assertEqual(list(live.osc_messages(position)), [('/lota/camera/position', [1.5, 0.30000001192092896, -2.0])])
        rotation = osc('/lota/camera/rotation', 0, 0, 0, 1)
        bundle = b'#bundle\0' + b'\0' * 8 + b''.join(struct.pack('>i', len(m)) + m for m in (position, rotation))
        self.assertEqual([a for a, _ in live.osc_messages(bundle)], ['/lota/camera/position', '/lota/camera/rotation'])
        self.assertEqual(list(live.osc_messages(b'garbage')), [])

    def test_frame_is_thinned_and_carries_pose(self):
        async def run():
            hub = live.Hub(); q = hub.subscribe()
            hub.pose('/lota/camera/position', [1, 2, 3]); hub.pose('/lota/camera/rotation', [0, 0, 0, 1])
            while not q.empty():
                q.get_nowait()  # Pose-only messages.
            n = 20000; points = np.zeros(n, dtype=live.POINT); points['p'] = np.arange(n * 3).reshape(n, 3); points['p'][0] = np.nan
            hub.frame(points.tobytes(), n)
            message = q.get_nowait()
            count, = struct.unpack_from('<I', message)
            self.assertEqual(count, live.PER_FRAME)
            self.assertEqual(len(message), 4 + 32 + 15 * count)
            self.assertEqual(struct.unpack_from('<8f', message, 4), (1, 2, 3, 0, 0, 0, 1, 1))
            self.assertTrue(np.isfinite(np.frombuffer(message, '<f4', count * 3, 36)).all())
            hub.frame(points.tobytes(), n)  # Within the frame-rate limit: dropped.
            self.assertTrue(q.empty())
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
