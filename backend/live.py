"""Live preview relay: LOTA's TCP point stream + OSC camera pose -> browser WebSocket.

LOTA PLY stream (documented): per frame, UInt32 LE point count, then N x (3 float32 XYZ + 3 uint8 RGB).
LOTA OSC (UDP): /lota/camera/position x y z, /lota/camera/rotation qx qy qz qw (~30 Hz).
Frames are thinned before forwarding; this is a preview, not the reconstruction.
Whether streamed points are world- or camera-space is undocumented; the browser applies the pose if asked.
"""
import asyncio, os, struct, time
import numpy as np

HOST = os.environ.get('HTV_LIVE_HOST', '0.0.0.0')
PLY_PORT = int(os.environ.get('HTV_LIVE_PLY_PORT', '9848'))
OSC_PORT = int(os.environ.get('HTV_LIVE_OSC_PORT', '9000'))
# Optional: connect out to the phone instead of waiting for it, e.g. HTV_LOTA_PHONE=192.168.1.20:9848
PHONE = os.environ.get('HTV_LOTA_PHONE', '')
MAX_FPS = 10
PER_FRAME = 8000
MAX_POINTS = 400_000  # Larger frames are treated as a corrupt stream.
POINT = np.dtype([('p', '<f4', 3), ('c', 'u1', 3)])


def osc_messages(data):
    """Yield (address, args) from an OSC packet or bundle (float, int, double, string args)."""
    if data.startswith(b'#bundle\0'):
        off = 16
        while off + 4 <= len(data):
            size, = struct.unpack_from('>i', data, off); off += 4
            yield from osc_messages(data[off:off + size]); off += size
        return
    def string(off):
        end = data.index(b'\0', off)
        return data[off:end].decode('ascii', 'replace'), (end + 4) & ~3
    try:
        address, off = string(0)
        tags, off = string(off)
        args = []
        for tag in tags[1:]:
            if tag in 'fi':
                args.append(struct.unpack_from('>f' if tag == 'f' else '>i', data, off)[0]); off += 4
            elif tag == 'd':
                args.append(struct.unpack_from('>d', data, off)[0]); off += 8
            elif tag == 's':
                value, off = string(off); args.append(value)
            else:
                break
        yield address, args
    except (ValueError, struct.error):
        return


class Hub:
    def __init__(self):
        self.clients = set(); self.started = False; self.error = None
        self.position = None; self.rotation = None
        self.streams = 0; self.peer = None; self.frames = 0; self.sent = 0; self.last_sent = 0.0
        self.last_frame = 0.0; self.last_pose = 0.0; self.pose_sent = 0.0

    # ---- browser side ----
    def subscribe(self):
        q = asyncio.Queue(maxsize=3); self.clients.add(q); return q

    def unsubscribe(self, q):
        self.clients.discard(q)

    def broadcast(self, message):
        for q in list(self.clients):
            if q.full():  # Slow browser: drop its oldest message rather than buffering without bound.
                q.get_nowait()
            q.put_nowait(message)

    def status(self):
        now = time.monotonic()
        return {'type': 'status', 'ply_port': PLY_PORT, 'osc_port': OSC_PORT, 'error': self.error,
                'stream_connected': self.streams > 0, 'peer': self.peer, 'frames': self.frames,
                'stream_live': now - self.last_frame < 2, 'pose_live': now - self.last_pose < 2}

    # ---- phone side ----
    async def start(self):
        if self.started:
            return
        self.started = True
        loop = asyncio.get_running_loop()
        errors = []
        try:
            await loop.create_datagram_endpoint(lambda: Osc(self), local_addr=(HOST, OSC_PORT))
        except OSError as e:
            errors.append(f'OSC UDP {OSC_PORT}: {e.strerror or e}')
        if PHONE:
            asyncio.create_task(self.dial())
        else:
            try:
                await asyncio.start_server(self.receive, HOST, PLY_PORT)
            except OSError as e:
                errors.append(f'TCP {PLY_PORT}: {e.strerror or e}')
        self.error = '; '.join(errors) or None
        asyncio.create_task(self.heartbeat())

    async def heartbeat(self):
        while True:
            self.broadcast(self.status()); await asyncio.sleep(1)

    async def dial(self):
        host, _, port = PHONE.rpartition(':')
        while True:
            try:
                reader, writer = await asyncio.open_connection(host, int(port))
                await self.receive(reader, writer)
            except OSError:
                pass
            await asyncio.sleep(2)

    async def receive(self, reader, writer):
        self.streams += 1; self.peer = (writer.get_extra_info('peername') or ('?',))[0]
        try:
            while True:
                n, = struct.unpack('<I', await reader.readexactly(4))
                if n > MAX_POINTS:
                    break
                self.frame(await reader.readexactly(n * POINT.itemsize), n)
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            self.streams -= 1; writer.close()

    def frame(self, body, n):
        self.frames += 1; now = time.monotonic(); self.last_frame = now
        if not self.clients or now - self.last_sent < 1 / MAX_FPS:
            return
        self.last_sent = now
        points = np.frombuffer(body, dtype=POINT, count=n)
        points = points[np.isfinite(points['p']).all(axis=1)]
        if len(points) > PER_FRAME:
            points = points[np.random.default_rng().choice(len(points), PER_FRAME, replace=False)]
        self.broadcast(struct.pack('<I', len(points)) + self.pose_bytes() + points['p'].tobytes() + points['c'].tobytes())

    def pose_bytes(self):
        if self.position is None or self.rotation is None:
            return struct.pack('<8f', *[0] * 8)
        return struct.pack('<8f', *self.position, *self.rotation, 1)

    def pose(self, address, args):
        if address == '/lota/camera/position' and len(args) >= 3:
            self.position = [float(a) for a in args[:3]]
        elif address == '/lota/camera/rotation' and len(args) >= 4:
            self.rotation = [float(a) for a in args[:4]]
        else:
            return
        now = time.monotonic(); self.last_pose = now
        if self.position and self.rotation and now - self.pose_sent > 1 / MAX_FPS:
            self.pose_sent = now
            self.broadcast({'type': 'pose', 'position': self.position, 'rotation': self.rotation})


class Osc(asyncio.DatagramProtocol):
    def __init__(self, hub):
        self.hub = hub

    def datagram_received(self, data, addr):
        for address, args in osc_messages(data):
            self.hub.pose(address, args)


hub = Hub()
