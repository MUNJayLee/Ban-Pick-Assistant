# -*- coding: utf-8 -*-
# 针对铠/关羽，测试不同裁剪参数（圆半径比例、ROI尺寸系数、缩放尺寸）下的 ORB 排名
import json
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

def circular_variant(img, size, radius_ratio, final=256):
    img = cv2.resize(img, (size, size))
    m = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(m, (size//2, size//2), int(size * radius_ratio), 255, -1)
    img = img.copy(); img[m == 0] = 0
    return cv2.resize(img, (final, final))

manifest = json.load(open('avatars/manifest.json', encoding='utf-8'))
name_by_id = {m['id']: m['name'] for m in manifest}
ids = [m['id'] for m in manifest]

orb = cv2.ORB_create(nfeatures=1000)
bf = cv2.BFMatcher(cv2.NORM_HAMMING)

SHOT = '测试用例/62f73ca5e389165a91ac3fff2dab97a1.jpg'
# 铠(敌方1) 和 关羽(敌方4)
TARGETS = [('kai', 1551, 38, 21), ('guanyu', 1719, 37, 23)]

shot = imread_unicode(SHOT)
H, W = shot.shape[:2]

def build_av(radius_ratio, size):
    av_des = {}
    for m in manifest:
        av = circular_variant(imread_unicode('avatars/%s.jpg' % m['id']), size, radius_ratio)
        kp, des = orb.detectAndCompute(av, None)
        if des is not None:
            av_des[m['id']] = des
    return av_des

def test(radius_ratio, roi_coeff, size):
    av_des = build_av(radius_ratio, size)
    out = []
    for (gt, cx, cy, r) in TARGETS:
        sz = int(r * roi_coeff)
        x = max(0, cx - sz//2); y = max(0, cy - sz//2)
        x = min(x, W - sz); y = min(y, H - sz)
        q = circular_variant(shot[y:y+sz, x:x+sz], sz, radius_ratio)
        kp, qdes = orb.detectAndCompute(q, None)
        scores = []
        for hid, des in av_des.items():
            ms = bf.knnMatch(qdes, des, k=2)
            good = [m for m, n in ms if m.distance < 0.75 * n.distance]
            scores.append((hid, len(good)))
        scores.sort(key=lambda x: -x[1])
        rank = next((i for i, (h, _) in enumerate(scores) if h == gt), -1)
        out.append(f'{gt}: rank{rank+1} score{scores[rank][1] if rank>=0 else 0}')
    return out

# 当前默认: radius=0.5, roi_coeff=2.2, size=48
configs = [
    (0.5, 2.2, 48),   # 当前
    (0.45, 2.2, 48),
    (0.40, 2.2, 48),
    (0.35, 2.2, 48),
    (0.5, 2.0, 48),
    (0.5, 1.8, 48),
    (0.40, 1.8, 48),
    (0.35, 1.8, 48),
    (0.5, 2.2, 64),
    (0.4, 1.8, 64),
]
for (rr, rc, sz) in configs:
    r = test(rr, rc, sz)
    print(f'radius={rr} roi={rc} size={sz} -> ' + ' | '.join(r))
