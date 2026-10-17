"""Create an explicitly synthetic planar capture to verify plumbing without a phone."""
from pathlib import Path
import sys, json, uuid, time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
from PIL import Image
from backend.capture import prepare
ROOT=Path(__file__).resolve().parents[1]
def make(folder):
    folder.mkdir(parents=True,exist_ok=True)
    for i in range(3):
        stem=f'frame_{i+1:06d}';w,h=192,144;K=[150,0,96,0,150,72,0,0,1]
        T=np.eye(4);T[0,3]=i*.1;T[1,3]=1
        v,u=np.mgrid[:h,:w];rgb=np.zeros((h,w,3),dtype='uint8')
        rgb[:,:,0]=80+(u//12%2)*70;rgb[:,:,1]=110+(v//12%2)*80;rgb[:,:,2]=120
        Image.fromarray(rgb).save(folder/f'{stem}.jpg')
        np.full((h,w),2,dtype='<f4').tofile(folder/f'{stem}.depth')
        np.full((h,w),2,dtype='u1').tofile(folder/f'{stem}.confidence')
        (folder/f'{stem}.json').write_text(json.dumps({'version':1,'width':w,'height':h,'intrinsics':K,'transform':T.flatten().tolist(),'timestamp':i*.5,'depthWidth':w,'depthHeight':h}))
if __name__=='__main__':
    sid=uuid.uuid4().hex;folder=ROOT/'data'/'sessions'/sid;make(folder);result=prepare(folder)
    (folder/'session.json').write_text(json.dumps({'id':sid,'created_at':time.time(),'demo':True,'status':'prepared','error':None,**result}))
    print('Created SYNTHETIC TEST CAPTURE:',sid)
