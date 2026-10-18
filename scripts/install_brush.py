"""Reinstall the pinned official Apple Silicon Brush release (no admin changes)."""
from pathlib import Path
import hashlib,tarfile,urllib.request
ROOT=Path(__file__).resolve().parents[1];tools=ROOT/'tools';tools.mkdir(exist_ok=True)
url='https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-aarch64-apple-darwin.tar.xz'
archive=tools/'brush.tar.xz';urllib.request.urlretrieve(url,archive)
expected=urllib.request.urlopen(url+'.sha256').read().decode().split()[0]
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise SystemExit('Checksum mismatch; not installing.')
with tarfile.open(archive) as t:
    for m in t.getmembers():
        if m.isfile() and Path(m.name).name=='brush_app':
            binary=tools/'brush_app';binary.write_bytes(t.extractfile(m).read());binary.chmod(0o755)
        if m.isfile() and 'LICENSE' in Path(m.name).name:
            dest=tools/'brush';dest.mkdir(exist_ok=True);(dest/Path(m.name).name).write_bytes(t.extractfile(m).read())
print('Installed checksum-verified Brush v0.3.0 at',tools/'brush_app')
