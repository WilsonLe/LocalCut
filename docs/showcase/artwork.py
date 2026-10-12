from PIL import Image, ImageDraw, ImageFilter
import numpy as np
from pathlib import Path
p=Path(__file__).resolve().with_name('assets');p.mkdir(exist_ok=True)
w,h=1600,1000
rng=np.random.default_rng(213)
for k,palette in enumerate([[(37,44,52),(231,174,104),(46,65,68),(164,109,70)],[(18,42,54),(207,225,226),(18,69,72),(91,140,137)],[(70,50,46),(227,186,147),(81,47,45),(163,99,74)]]):
 a=np.zeros((h,w,3));top,bottom,dark,light=map(np.array,palette)
 for y in range(h): a[y]=top*(1-y/h)+bottom*y/h
 im=Image.fromarray(a.astype('uint8'));d=ImageDraw.Draw(im)
 d.ellipse((1080,130,1270,320),fill=tuple(bottom))
 for layer in range(6):
  pts=[(0,h)]
  for x in range(0,w+20,20):
   y=480+layer*89+100*np.sin(x/310+k+layer*.8)+40*np.sin(x/135+layer)
   pts.append((x,int(y)))
  pts.append((w,h));c=dark*(1-layer/7)+light*(layer/7)
  d.polygon(pts,fill=tuple(c.astype(int)))
 ar=np.asarray(im).astype(float);noise=rng.normal(0,1.7,(h,w,1));ar=np.clip(ar+noise,0,255).astype('uint8')
 Image.fromarray(ar).save(p/f'landscape-{k+1}.jpg',quality=88)
