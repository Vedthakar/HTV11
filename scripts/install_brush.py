"""Reinstall the pinned official Brush release for this OS (no admin changes)."""
from pathlib import Path
import hashlib,io,platform,sys,tarfile,urllib.request,zipfile
ROOT=Path(__file__).resolve().parents[1];tools=ROOT/'tools';tools.mkdir(exist_ok=True)
# Windows stays on 0.2.0: v0.3.0 fails every dataset load there with "IO error ... early eof".
targets={('win32','AMD64'):('0.2.0','brush-app-x86_64-pc-windows-msvc.zip'),
         ('darwin','arm64'):('v0.3.0','brush-app-aarch64-apple-darwin.tar.xz'),
         ('linux','x86_64'):('v0.3.0','brush-app-x86_64-unknown-linux-gnu.tar.xz')}
if (sys.platform,platform.machine()) not in targets:raise SystemExit(f'No pinned Brush release for {sys.platform}/{platform.machine()}.')
version,name=targets[(sys.platform,platform.machine())]
base=f'https://github.com/ArthurBrussee/brush/releases/download/{version}/'
exe='brush_app.exe' if sys.platform=='win32' else 'brush_app'
print('Downloading Brush',version,name,'...')
data=urllib.request.urlopen(base+name).read()
expected=urllib.request.urlopen(base+name+'.sha256').read().decode().split()[0]
if hashlib.sha256(data).hexdigest()!=expected:raise SystemExit('Checksum mismatch; not installing.')
if name.endswith('.zip'):
    archive=zipfile.ZipFile(io.BytesIO(data));members=[(m.filename,lambda m=m:archive.read(m)) for m in archive.infolist() if not m.is_dir()]
else:
    archive=tarfile.open(fileobj=io.BytesIO(data));members=[(m.name,lambda m=m:archive.extractfile(m).read()) for m in archive.getmembers() if m.isfile()]
for member,read in members:
    base_name=Path(member).name
    if base_name==exe:
        binary=tools/exe;binary.write_bytes(read());binary.chmod(0o755)
    elif 'LICENSE' in base_name:
        dest=tools/'brush';dest.mkdir(exist_ok=True);(dest/base_name).write_bytes(read())
if not (tools/exe).is_file():raise SystemExit(f'{exe} not found in {name}.')
print(f'Installed checksum-verified Brush {version} at',tools/exe)
