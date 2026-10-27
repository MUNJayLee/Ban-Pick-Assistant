# -*- coding: utf-8 -*-
# 从 3 张红框示意图提取锁模板，保存并对比（供人工确认 + 后续模板匹配）
import cv2
import numpy as np
import glob

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

files = sorted(glob.glob('测试用例/锁示意图/*.png'))
templates = []
for i, f in enumerate(files):
    img = imread_unicode(f)
    b, g, r = img[:, :, 0].astype(int), img[:, :, 1].astype(int), img[:, :, 2].astype(int)
    red = (r > 150) & (g < 100) & (b < 100)
    ys, xs = np.where(red)
    if not len(xs):
        continue
    lock = img[ys.min()+4:ys.max()-3, xs.min()+4:xs.max()-3]
    # 归一化到 64x64
    lock = cv2.resize(lock, (64, 64))
    templates.append(lock)
    cv2.imwrite(f'models/lock_{i}.png', lock)
    print(f'锁{i}: {files[i].split(chr(92))[-1]} 原始 {lock.shape}')

# 两两归一化互相关（判断是否是同一形状）
print('\n锁模板两两相关性（灰度）:')
for i in range(len(templates)):
    for j in range(i+1, len(templates)):
        a = cv2.cvtColor(templates[i], cv2.COLOR_BGR2GRAY).astype(np.float32)
        c = cv2.cvtColor(templates[j], cv2.COLOR_BGR2GRAY).astype(np.float32)
        a -= a.mean(); c -= c.mean()
        corr = (a*c).sum() / (np.linalg.norm(a)*np.linalg.norm(c) + 1e-8)
        print(f'  锁{i} vs 锁{j}: {corr:.3f}')
