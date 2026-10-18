"""Optional Brush training; point-cloud preparation remains available independently."""
import os
import shutil
import subprocess
from pathlib import Path


def brush_binary(root):
    candidates=[os.environ.get('BRUSH_BIN'),shutil.which('brush_app'),shutil.which('brush'),str(root/'tools'/'brush_app')]
    return next((p for p in candidates if p and Path(p).is_file() and os.access(p,os.X_OK)),None)


def train(folder, binary):
    dataset=folder/'dataset'
    cameras=(dataset/'transforms.json').is_file() or any((dataset/'sparse').rglob('images.bin')) or any((dataset/'sparse').rglob('images.txt'))
    if not cameras:raise ValueError('Gaussian training requires capture photos and camera poses, not a point-cloud-only import.')
    output=folder/'trained'/__import__('uuid').uuid4().hex;output.mkdir(parents=True)
    cmd=[binary,str(dataset),'--total-steps','1500','--max-resolution','720','--export-every','1500','--export-path',str(output),'--export-name','scene.ply']
    with (folder/'train.log').open('w') as log:
        result=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,timeout=1800)
    if result.returncode:raise ValueError('Brush training failed. Open train.log for details; the point cloud remains available.')
    matches=list(output.rglob('*.ply'))
    if not matches:raise ValueError('Brush completed without exporting a Gaussian PLY. Check train.log.')
    temp=folder/'scene.ply.tmp';shutil.copy2(max(matches,key=lambda p:p.stat().st_mtime),temp);temp.replace(folder/'scene.ply')
