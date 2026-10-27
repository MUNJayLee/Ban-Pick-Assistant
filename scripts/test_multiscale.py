# -*- coding: utf-8 -*-
# 多尺度裁剪：每个头像在多个圆半径下算描述子，匹配时取最优。验证两张截图的准确率
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

RADII = [0.35, 0.40, 0.45, 0.50]
SIZE = 48

# 每个头像在每个半径下算描述子
av_des = {m['id']: {} for m in manifest}
for rr in RADII:
    for m in manifest:
        av = circular_variant(imread_unicode('avatars/%s.jpg' % m['id']), SIZE, rr)
        kp, des = orb.detectAndCompute(av, None)
        if des is not None:
            av_des[m['id']][rr] = des

def match_query(qdes, hid):
    best = 0
    for rr in RADII:
        des = av_des[hid].get(rr)
        if des is None:
            continue
        ms = bf.knnMatch(qdes, des, k=2)
        good = [m for m, n in ms if m.distance < 0.75 * n.distance]
        best = max(best, len(good))
    return best

def evaluate(shot_path, circles, gt):
    shot = imread_unicode(shot_path)
    H, W = shot.shape[:2]
    correct = 0
    total = 0
    details = []
    for (cx, cy, r), g in zip(circles, gt):
        if g is None:
            continue
        total += 1
        sz = int(r * 2.2)
        x = max(0, cx - sz//2); y = max(0, cy - sz//2)
        x = min(x, W - sz); y = min(y, H - sz)
        q = circular_variant(shot[y:y+sz, x:x+sz], sz, 0.5)  # 查询端仍用 0.5 圆
        kp, qdes = orb.detectAndCompute(q, None)
        if qdes is None:
            details.append(f'{g}: 无特征')
            continue
        scores = [(hid, match_query(qdes, hid)) for hid in ids]
        scores.sort(key=lambda x: -x[1])
        ok = scores[0][0] == g
        if ok: correct += 1
        rank = next((i for i, (h, _) in enumerate(scores) if h == g), -1)
        details.append(f'{g} -> {name_by_id[scores[0][0]]} rank{rank+1} {"OK" if ok else "FAIL"}')
    return correct, total, details

# 截图1
c1 = [(43,41,25),(61,113,21),(85,61,22),(151,29,30),(197,31,31),(1375,43,26),(1423,37,29),(1435,115,23),(1471,43,26),(1481,115,17)]
g1 = ['xiangyu','yixing','cang','yuanliuzhizi_support','niumo','lixin','yunzhongjun','cang','zhugeliang','caocao']
r1 = evaluate('runtime-screenshot.png', c1, g1)
print(f'截图1: {r1[0]}/{r1[1]}')
for d in r1[2]: print(' ', d)

# 截图2
c2 = [(141,38,24),(197,37,23),(256,38,24),(313,37,23),(370,38,27),(1551,38,21),(1607,39,22),(1663,38,23),(1719,37,23),(1777,38,24)]
g2 = ['dunshan','donghuangtaiyi','yunyao','zhangliang',None,'kai','dayu','zhangliang','guanyu','sunquan']
r2 = evaluate('测试用例/62f73ca5e389165a91ac3fff2dab97a1.jpg', c2, g2)
print(f'\n截图2: {r2[0]}/{r2[1]}')
for d in r2[2]: print(' ', d)
