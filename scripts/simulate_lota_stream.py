"""Send a SYNTHETIC LOTA-format live stream (TCP point frames + OSC camera pose) for testing.

Usage: npm run simulate-live -- [--host 127.0.0.1] [--space world|camera] [--seconds 30]
Frames: UInt32 LE count + N x (3 float32 XYZ + 3 uint8 RGB), as LOTA documents for its PLY stream.
"""
from pathlib import Path
import argparse, socket, struct, sys, time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from backend.capture import quaternion
from scripts.make_lota_fixture import room, poses, SPIKE


def osc(address, *floats):
    def pad(b):
        return b + b'\0' * (4 - len(b) % 4)
    return pad(address.encode()) + pad((',' + 'f' * len(floats)).encode()) + struct.pack(f'>{len(floats)}f', *floats)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=9848)
    parser.add_argument('--osc-port', type=int, default=9000)
    parser.add_argument('--space', choices=['world', 'camera'], default='world')
    parser.add_argument('--seconds', type=float, default=30)
    parser.add_argument('--fps', type=float, default=30)
    args = parser.parse_args()
    xyz, rgb = room(); path = [T for i, T in enumerate(poses()) if i != SPIKE]
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    tcp = socket.create_connection((args.host, args.port), timeout=5)
    print(f'Streaming SYNTHETIC {args.space}-space frames to {args.host}:{args.port}, pose to UDP {args.osc_port}')
    rng = np.random.default_rng(1); start = time.monotonic(); sent = 0
    while (t := time.monotonic() - start) < args.seconds:
        # Drive along the fixture path and back, interpolating position (rotation from the nearest pose).
        u = (t / 10) % 2; u = u if u <= 1 else 2 - u; f = u * (len(path) - 1); i = min(int(f), len(path) - 2)
        T = path[i].copy(); T[:3, 3] = path[i][:3, 3] * (1 - (f - i)) + path[i + 1][:3, 3] * (f - i)
        cam = (np.linalg.inv(T) @ np.c_[xyz, np.ones(len(xyz))].T)[:3].T
        visible = (cam[:, 2] < -0.2) & (cam[:, 2] > -4) & (np.abs(cam[:, 0]) < -cam[:, 2]) & (np.abs(cam[:, 1]) < -cam[:, 2] * .75)
        pick = rng.choice(np.flatnonzero(visible), min(visible.sum(), 12000), replace=False)
        pts = np.empty(len(pick), dtype=[('p', '<f4', 3), ('c', 'u1', 3)])
        pts['p'] = (cam if args.space == 'camera' else xyz)[pick]; pts['c'] = rgb[pick]
        tcp.sendall(struct.pack('<I', len(pts)) + pts.tobytes())
        w, x, y, z = quaternion(T[:3, :3])
        udp.sendto(osc('/lota/camera/position', *T[:3, 3]), (args.host, args.osc_port))
        udp.sendto(osc('/lota/camera/rotation', x, y, z, w), (args.host, args.osc_port))
        sent += 1; time.sleep(max(0, sent / args.fps - (time.monotonic() - start)))
    tcp.close(); print(f'Sent {sent} frames')


if __name__ == '__main__':
    main()
