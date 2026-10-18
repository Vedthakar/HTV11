"""Import LOTA (LiDAR Over the Air) Gaussian Capture ZIPs into a prepared session.

Supported exports: Nerfstudio / Nerfstudio + Depth (transforms.json, images/, points3D.ply),
COLMAP binary (cameras.bin, images.bin, points3D.bin) and a standalone points3D.ply.
The dataset (photos, depth, poses) is kept as LOTA wrote it; only the viewer copies
(cloud.ply, trajectory.json) are converted to the viewer's Y-up axes.
"""
from pathlib import Path, PurePosixPath
import json, os, re, shutil, struct, zipfile
import numpy as np

MAX_ENTRIES = 200_000
MAX_POINTS = 200_000
# LOTA documents Y-up captures (ARKit world). If a real export arrives Z-up, set HTV_LOTA_UP=z.
UP_AXIS = os.environ.get('HTV_LOTA_UP', 'y').lower()
SYNTHETIC_MARKER = 'SYNTHETIC_TEST_CAPTURE.txt'


def to_viewer(xyz):
    if UP_AXIS == 'z':  # Z-up -> Y-up: rotate -90 degrees about X.
        return np.stack([xyz[:, 0], xyz[:, 2], -xyz[:, 1]], axis=1)
    return xyz


# ---------- ZIP extraction ----------

def extract(zip_path, dest, max_bytes):
    """Extract without trusting entry names or declared sizes."""
    with zipfile.ZipFile(zip_path) as z:
        infos = [i for i in z.infolist() if not i.is_dir()]
        if len(infos) > MAX_ENTRIES:
            raise ValueError('ZIP has too many files')
        written = 0
        for info in infos:
            name = info.filename.replace('\\', '/')
            parts = PurePosixPath(name).parts
            if name.startswith('/') or ':' in name or '..' in parts or not parts:
                raise ValueError(f'Unsafe path in ZIP: {info.filename}')
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('ZIP contains a symbolic link')
            if parts[0] == '__MACOSX' or parts[-1] in ('.DS_Store', 'Thumbs.db'):
                continue
            target = dest.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, target.open('wb') as out:
                while chunk := src.read(1 << 20):
                    written += len(chunk)
                    if written > max_bytes:
                        raise ValueError('ZIP contents exceed the import size limit')
                    out.write(chunk)


def shallowest(root, pattern):
    found = sorted(root.rglob(pattern), key=lambda f: (len(f.relative_to(root).parts), str(f)))
    return found[0] if found else None


def natural(name):
    return [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', str(name))]


# ---------- Readers ----------

PLY_TYPES = {'char': 'i1', 'int8': 'i1', 'uchar': 'u1', 'uint8': 'u1', 'short': 'i2', 'int16': 'i2',
             'ushort': 'u2', 'uint16': 'u2', 'int': 'i4', 'int32': 'i4', 'uint': 'u4', 'uint32': 'u4',
             'float': 'f4', 'float32': 'f4', 'double': 'f8', 'float64': 'f8'}


def read_ply(path):
    """Vertex positions and colours from an ASCII or binary little-endian PLY."""
    with path.open('rb') as f:
        if f.readline().strip() != b'ply':
            raise ValueError(f'{path.name} is not a PLY file')
        fmt = None; elements = []
        while True:
            line = f.readline()
            if not line:
                raise ValueError(f'{path.name} has no end_header')
            words = line.decode('ascii', 'replace').split()
            if not words or words[0] in ('comment', 'obj_info'):
                continue
            if words[0] == 'end_header':
                break
            if words[0] == 'format':
                fmt = words[1]
            elif words[0] == 'element':
                elements.append([words[1], int(words[2]), []])
            elif words[0] == 'property':
                if words[1] == 'list':
                    elements[-1][2].append((words[-1], None))
                else:
                    elements[-1][2].append((words[2], PLY_TYPES[words[1]]))
        if fmt not in ('ascii', 'binary_little_endian'):
            raise ValueError(f'Unsupported PLY format {fmt} in {path.name}')
        vertex = None
        for name, count, props in elements:
            if any(t is None for _, t in props):
                if name == 'vertex':
                    raise ValueError('PLY vertex lists are not supported')
                break  # Variable-size elements after the vertices are irrelevant.
            dtype = np.dtype([(n, '<' + t) for n, t in props])
            if fmt == 'ascii':
                rows = np.loadtxt(f, max_rows=count, ndmin=2)
                data = np.zeros(count, dtype=dtype)
                for i, (n, _) in enumerate(props):
                    data[n] = rows[:, i]
            else:
                data = np.frombuffer(f.read(dtype.itemsize * count), dtype=dtype, count=count)
            if name == 'vertex':
                vertex = data
                break
    if vertex is None or not {'x', 'y', 'z'} <= set(vertex.dtype.names):
        raise ValueError(f'{path.name} has no vertex positions')
    xyz = np.stack([vertex['x'], vertex['y'], vertex['z']], axis=1).astype(np.float64)
    names = vertex.dtype.names
    channels = next((c for c in (('red', 'green', 'blue'), ('diffuse_red', 'diffuse_green', 'diffuse_blue'))
                     if set(c) <= set(names)), None)
    if channels:
        rgb = np.stack([vertex[c] for c in channels], axis=1).astype(np.float64)
        if vertex[channels[0]].dtype.kind == 'f' and rgb.max(initial=0) <= 1:
            rgb *= 255
        rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    else:
        rgb = np.full((len(xyz), 3), 190, np.uint8)
    return xyz, rgb


def read_colmap_points(path):
    data = path.read_bytes(); n, = struct.unpack_from('<Q', data, 0); off = 8
    xyz = np.empty((n, 3)); rgb = np.empty((n, 3), np.uint8)
    for i in range(n):
        xyz[i] = struct.unpack_from('<3d', data, off + 8)
        rgb[i] = struct.unpack_from('<3B', data, off + 32)
        track, = struct.unpack_from('<Q', data, off + 43)
        off += 51 + 8 * track
    return xyz, rgb


def read_colmap_images(path):
    """(name, camera centre, raw record bytes) per image; raw bytes allow rewriting the file."""
    data = path.read_bytes(); n, = struct.unpack_from('<Q', data, 0); off = 8; images = []
    for _ in range(n):
        start = off
        qw, qx, qy, qz, tx, ty, tz = struct.unpack_from('<7d', data, off + 4)
        end = data.index(b'\0', off + 64)
        name = data[off + 64:end].decode('utf-8')
        points, = struct.unpack_from('<Q', data, end + 1)
        off = end + 9 + 24 * points
        R = quat_to_matrix(qw, qx, qy, qz)
        images.append((name, -R.T @ np.array([tx, ty, tz]), data[start:off]))
    return images


def quat_to_matrix(w, x, y, z):
    return np.array([[1 - 2*(y*y + z*z), 2*(x*y - z*w), 2*(x*z + y*w)],
                     [2*(x*y + z*w), 1 - 2*(x*x + z*z), 2*(y*z - x*w)],
                     [2*(x*z - y*w), 2*(y*z + x*w), 1 - 2*(x*x + y*y)]])


# ---------- Cleanup ----------

def pose_spikes(positions, factor=6.0, floor=0.3):
    """Frames whose position jumps away and straight back (a jolt or tracking glitch).

    Returns (frames to drop, frames where the path jumps and never returns). A permanent
    jump means tracking relocalised; it cannot be repaired by dropping frames.
    """
    pos = np.asarray(positions, float)
    if len(pos) < 4:
        return set(), []
    steps = np.linalg.norm(np.diff(pos, axis=0), axis=1)
    limit = max(float(np.median(steps)) * factor, floor)
    drop = {i for i in range(1, len(pos) - 1)
            if steps[i-1] > limit and steps[i] > limit and np.linalg.norm(pos[i+1] - pos[i-1]) <= limit}
    jumps = [k + 1 for k, s in enumerate(steps) if s > limit and k not in drop and k + 1 not in drop]
    return drop, jumps


def clean_cloud(xyz, rgb, cap=MAX_POINTS, cell=0.10, min_neighbours=3, voxel=0.01):
    """Drop isolated floaters, thin to one point per centimetre voxel, then cap the count."""
    keep = np.isfinite(xyz).all(axis=1); xyz, rgb = xyz[keep], rgb[keep]
    if len(xyz) > 1000:
        _, inverse, counts = np.unique(np.floor(xyz / cell).astype(np.int64), axis=0,
                                       return_inverse=True, return_counts=True)
        dense = counts[inverse.ravel()] >= min_neighbours
        if dense.mean() > 0.8:  # Sparse clouds would lose real structure; leave them alone.
            xyz, rgb = xyz[dense], rgb[dense]
    _, first = np.unique(np.floor(xyz / voxel).astype(np.int64), axis=0, return_index=True)
    first.sort(); xyz, rgb = xyz[first], rgb[first]
    if len(xyz) > cap:
        pick = np.random.default_rng(0).choice(len(xyz), cap, replace=False); pick.sort()
        xyz, rgb = xyz[pick], rgb[pick]
    return xyz, rgb


def write_ply(path, xyz, rgb):
    vertex = np.empty(len(xyz), dtype=[('x', '<f4'), ('y', '<f4'), ('z', '<f4'),
                                       ('red', 'u1'), ('green', 'u1'), ('blue', 'u1')])
    vertex['x'], vertex['y'], vertex['z'] = xyz.T
    vertex['red'], vertex['green'], vertex['blue'] = rgb.T
    with path.open('wb') as f:
        f.write(f'ply\nformat binary_little_endian 1.0\nelement vertex {len(xyz)}\n'
                'property float x\nproperty float y\nproperty float z\n'
                'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n'.encode())
        f.write(vertex.tobytes())


# ---------- Format handlers ----------

def move_contents(src, dest):
    dest.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        shutil.move(str(item), str(dest / item.name))


def import_nerfstudio(transforms, dataset):
    move_contents(transforms.parent, dataset)
    meta = json.loads((dataset / 'transforms.json').read_text())
    frames = sorted(meta.get('frames') or [], key=lambda fr: natural(fr.get('file_path', '')))
    if len(frames) < 3:
        raise ValueError('transforms.json lists fewer than 3 frames')
    for fr in frames:
        if not (dataset / fr['file_path']).is_file():
            raise ValueError(f"Image listed in transforms.json is missing: {fr['file_path']}")
    positions = [np.array(fr['transform_matrix'], float)[:3, 3] for fr in frames]
    drop, jumps = pose_spikes(positions)
    if drop:
        shutil.copy2(dataset / 'transforms.json', dataset.parent / 'transforms.original.json')
        meta['frames'] = [fr for i, fr in enumerate(frames) if i not in drop]
        (dataset / 'transforms.json').write_text(json.dumps(meta, indent=2))
    ply = dataset / meta['ply_file_path'] if meta.get('ply_file_path') else dataset / 'points3D.ply'
    if not ply.is_file():
        ply = shallowest(dataset, '*.ply')
    if not ply:
        raise ValueError('Nerfstudio export has no point cloud (points3D.ply)')
    kept = [p for i, p in enumerate(positions) if i not in drop]
    fmt = 'nerfstudio+depth' if (dataset / 'depth').is_dir() else 'nerfstudio'
    return fmt, read_ply(ply), kept, drop, jumps, len(frames)


def import_colmap(images_bin, root, dataset):
    sparse = dataset / 'sparse' / '0'; sparse.mkdir(parents=True)
    for f in images_bin.parent.iterdir():
        if f.is_file():
            shutil.move(str(f), str(sparse / f.name))
    if not (sparse / 'cameras.bin').is_file():
        raise ValueError('COLMAP export is missing cameras.bin')
    images_dir = next((d / 'images' for d in [images_bin.parent, *images_bin.parents]
                       if (d / 'images').is_dir() and root in [d, *d.parents]), None)
    if images_dir is None:
        raise ValueError('COLMAP export has no images/ folder')
    shutil.move(str(images_dir), str(dataset / 'images'))
    records = sorted(read_colmap_images(sparse / 'images.bin'), key=lambda r: natural(r[0]))
    if len(records) < 3:
        raise ValueError('images.bin lists fewer than 3 images')
    for name, _, _ in records:
        if not (dataset / 'images' / name).is_file():
            raise ValueError(f'Image listed in images.bin is missing: {name}')
    drop, jumps = pose_spikes([r[1] for r in records])
    if drop:
        shutil.copy2(sparse / 'images.bin', dataset.parent / 'images.original.bin')
        kept = [r for i, r in enumerate(records) if i not in drop]
        (sparse / 'images.bin').write_bytes(struct.pack('<Q', len(kept)) + b''.join(r[2] for r in kept))
    points = sparse / 'points3D.bin'
    cloud = read_colmap_points(points) if points.is_file() else (np.empty((0, 3)), np.empty((0, 3), np.uint8))
    if not len(cloud[0]) and (ply := shallowest(root, '*.ply') or shallowest(dataset, '*.ply')):
        cloud = read_ply(ply)
    return 'colmap', cloud, [r[1] for i, r in enumerate(records) if i not in drop], drop, jumps, len(records)


def import_zip(zip_path, folder, max_bytes=8 << 30):
    """Unpack a LOTA ZIP into folder: dataset/, cloud.ply, trajectory.json. Returns session fields."""
    staging = folder / 'lota_extract'; dataset = folder / 'dataset'
    shutil.rmtree(staging, ignore_errors=True); shutil.rmtree(dataset, ignore_errors=True)
    try:
        try:
            extract(zip_path, staging, max_bytes)
        except zipfile.BadZipFile:
            raise ValueError('Upload is not a valid ZIP file')
        synthetic = shallowest(staging, SYNTHETIC_MARKER) is not None
        transforms = shallowest(staging, 'transforms.json')
        images_bin = shallowest(staging, 'images.bin')
        warnings = []
        if transforms:
            fmt, (xyz, rgb), path, drop, jumps, total = import_nerfstudio(transforms, dataset)
        elif images_bin:
            fmt, (xyz, rgb), path, drop, jumps, total = import_colmap(images_bin, staging, dataset)
        elif ply := (shallowest(staging, 'points3D.ply') or shallowest(staging, '*.ply')):
            fmt, (xyz, rgb), path, drop, jumps, total = 'ply', read_ply(ply), [], set(), [], 0
            warnings.append('Point cloud only: this export has no camera path or photos.')
        else:
            raise ValueError('No LOTA export found: expected transforms.json, COLMAP .bin files or a .ply')
        if drop:
            warnings.append(f'Dropped {len(drop)} frame(s) with position spikes (rover jolts or tracking glitches).')
        if jumps:
            warnings.append(f'Camera path jumps at {len(jumps)} frame(s) without returning; '
                            'tracking may have relocalised and parts of the map can be misaligned.')
        raw_points = len(xyz)
        xyz, rgb = clean_cloud(to_viewer(xyz), rgb)
        if not len(xyz):
            raise ValueError('Export contains no usable points')
        write_ply(folder / 'cloud.ply', xyz, rgb)
        (folder / 'trajectory.json').write_text(json.dumps(to_viewer(np.array(path).reshape(-1, 3)).tolist()))
        return {'source': 'lota', 'format': fmt, 'frames': total - len(drop), 'dropped_frames': len(drop),
                'raw_points': raw_points, 'points': len(xyz),
                'warnings': warnings, 'demo': synthetic}
    except Exception:
        shutil.rmtree(dataset, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)
