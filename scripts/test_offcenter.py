# -*- coding: utf-8 -*-
# 测试偏心圆裁剪（脸通常在立绘偏上方）对铠/关羽的排名影响
import json
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

def circular_offcenter(img, size, radius_ratio, cx_ratio, cy_ratio, final=256):
    img = cv2.resize(img, (size, size))
    m = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(m, (int(size*cx_ratio), int(size*cy_ratio)), int(size*radius_ratio), 255, -1)
    img = img.copy(); img[m == 0] = 0
    return cv2.resize(img, (final, final))

manifest = json.load(open('avatars/manifest.json', encoding='utf-8'))
name_by_id = {m['id']: m['name'] for m in manifest}
ids = [m['id'] for m in manifest]
orb = cv2.ORB_create(nfeatures=1000)
bf = cv2.BFMatcher(cv2.NORM_HAMMING)

SHOT = '测试用例/62f73ca5e389165a91ac3fff2dab97a1.jpg'
TARGETS = [('kai', 1551, 38, 21), ('guanyu', 1719, 37, 23)]
shot = imread_unicode(SHOT)
H, W = shot.shape[:2]

def rank_of(rr, cxr, cyr):
    av_des = {}
    for m in manifest:
        av = circular_offcenter(imread_unicode('avatars/%s.jpg' % m['id']), 48, rr, cxr, cyr)
        kp, des = orb.detectAndCompute(av, None)
        if des is not None: av_des[m['id']] = des
    out = []
    for (gt, cx, cy, r) in TARGETS:
        sz = int(r * 2.2)
        x = max(0, cx - sz//2); y = max(0, cy - sz//2)
        x = min(x, W - sz); y = min(y, H - sz)
        q = circular_offcenter(shot[y:y+sz, x:x+sz], sz, 0.5, 0.5, 0.5)
        kp, qdes = orb.detectAndCompute(q, None)
        scores = []
        for hid, des in av_des.items():
            ms = bf.knnMatch(qdes, des, k=2)
            good = [m for m, n in ms if m.distance < 0.75 * n.distance]
            scores.append((hid, len(good)))
        scores.sort(key=lambda x: -x[1])
        rk = next((i for i, (h, _) in enumerate(scores) if h == gt), -1)
        out.append(f'{gt}:rank{rk+1}')
    return out

configs = [
    (0.45, 0.5, 0.45),  # 半径0.45, 中心上移
    (0.45, 0.5, 0.40),
    (0.40, 0.5, 0.45),
    (0.40, 0.5, 0.40),
    (0.40, 0.5, 0.50),
    (0.35, 0.5, 0.45),
]
for (rr, cxr, cyr) in configs:
    print(f'radius={rr} center=({cxr},{cyr}) ->', ' | '.join(rank_of(rr, cxr, cyr)))
