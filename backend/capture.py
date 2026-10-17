"""Capture format v1: raw image orientation, row-major K/T, little-endian depth."""
from pathlib import Path
import json, shutil
import numpy as np
from PIL import Image


def quaternion(r):
    # Eigenvector method handles rotations near 180 degrees too. Returns w,x,y,z.
    from math import sqrt
    t = np.trace(r)
    if t > 0:
        s = sqrt(t + 1) * 2
        return [s / 4, (r[2, 1]-r[1, 2])/s, (r[0, 2]-r[2, 0])/s, (r[1, 0]-r[0, 1])/s]
    i = int(np.argmax(np.diag(r))); j = (i+1)%3; k = (i+2)%3
    s = sqrt(max(0, 1+r[i,i]-r[j,j]-r[k,k]))*2
    q = np.zeros(4); q[i+1]=s/4; q[0]=(r[k,j]-r[j,k])/s
    q[j+1]=(r[j,i]+r[i,j])/s; q[k+1]=(r[k,i]+r[i,k])/s
    return q.tolist()


def prepare(folder: Path):
    records = sorted(folder.glob('frame_*.json'))
    if len(records) < 3:
        raise ValueError('Capture at least 3 frames; a useful scene usually needs many more.')
    out = folder/'dataset'; (out/'images').mkdir(parents=True,exist_ok=True)
    sparse=out/'sparse'/'0'; sparse.mkdir(parents=True,exist_ok=True)
    cameras=[]; images=[]; frames=[]; clouds=[]; colors=[]; trajectory=[]
    flip=np.diag([1.,-1.,-1.])
    for idx,p in enumerate(records,1):
        m=json.loads(p.read_text()); stem=p.stem
        w,h=int(m['width']),int(m['height'])
        K=np.array(m['intrinsics'],dtype=float).reshape(3,3)
        T=np.array(m['transform'],dtype=float).reshape(4,4)
        if not np.isfinite(K).all() or not np.isfinite(T).all() or K[0,0]<=0 or K[1,1]<=0:
            raise ValueError(f'Invalid calibration in {p.name}')
        image=folder/f'{stem}.jpg'
        with Image.open(image) as im:
            if im.size!=(w,h):raise ValueError(f'Image size mismatch: {image.name}')
        shutil.copy2(image,out/'images'/image.name)
        cameras.append(f'{idx} PINHOLE {w} {h} {K[0,0]} {K[1,1]} {K[0,2]} {K[1,2]}')
        inv=np.linalg.inv(T); R=flip@inv[:3,:3]; t=flip@inv[:3,3]
        q=quaternion(R)
        images.append(f"{idx} {' '.join(map(str,q))} {' '.join(map(str,t))} {idx} {image.name}\n")
        frames.append({'file_path':f'images/{image.name}','transform_matrix':T.tolist(),'fl_x':K[0,0],'fl_y':K[1,1],'cx':K[0,2],'cy':K[1,2],'w':w,'h':h})
        trajectory.append(T[:3,3].tolist())
        if m.get('depthWidth') and (folder/f'{stem}.depth').exists():
            dw,dh=int(m['depthWidth']),int(m['depthHeight'])
            d=np.fromfile(folder/f'{stem}.depth',dtype='<f4').reshape(dh,dw)
            v,u=np.mgrid[0:dh:6,0:dw:6]; z=d[v,u]
            valid=np.isfinite(z)&(z>.15)&(z<6)
            confidence=folder/f'{stem}.confidence'
            if confidence.exists():valid &= np.fromfile(confidence,dtype='u1').reshape(dh,dw)[v,u]>=1
            z=z[valid]; u=u[valid];v=v[valid]
            # ARKit camera: +x right, +y up, -z forward. Scale K to depth resolution.
            x=(u-K[0,2]*dw/w)/(K[0,0]*dw/w)*z
            y=-(v-K[1,2]*dh/h)/(K[1,1]*dh/h)*z
            pts=(T@np.vstack([x,y,-z,np.ones_like(z)]))[:3].T
            with Image.open(image) as im:rgb=np.array(im.convert('RGB').resize((dw,dh)))[v,u]
            clouds.append(pts);colors.append(rgb)
    if not clouds or sum(len(c) for c in clouds)==0:
        raise ValueError('No usable LiDAR points. Check scene depth and confidence on the phone.')
    xyz=np.concatenate(clouds);rgb=np.concatenate(colors)
    if len(xyz)>200000:
        keep=np.random.default_rng(0).choice(len(xyz),200000,replace=False);xyz=xyz[keep];rgb=rgb[keep]
    (sparse/'cameras.txt').write_text('\n'.join(cameras)+'\n')
    (sparse/'images.txt').write_text('\n'.join(images)+'\n')
    with (sparse/'points3D.txt').open('w') as f:
        for i,(p,c) in enumerate(zip(xyz,rgb),1):f.write(f"{i} {' '.join(map(str,p))} {' '.join(map(str,c))} 0\n")
    (out/'transforms.json').write_text(json.dumps({'camera_model':'OPENCV','frames':frames},indent=2))
    with (folder/'cloud.ply').open('w') as f:
        f.write(f'ply\nformat ascii 1.0\nelement vertex {len(xyz)}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n')
        for p,c in zip(xyz,rgb):f.write(' '.join(map(str,[*p,*c]))+'\n')
    (folder/'trajectory.json').write_text(json.dumps(trajectory))
    return {'frames':len(records),'points':len(xyz),'dataset':str(out)}
