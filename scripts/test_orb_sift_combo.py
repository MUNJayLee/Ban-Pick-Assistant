# -*- coding: utf-8 -*-
# 对比 ORB / SIFT / ORB+SIFT融合 在两张截图上的准确率
import json
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

def circular(img, size):
    img = cv2.resize(img, (size, size))
    m = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(m, (size//2, size//2), size//2, 255, -1)
    img = img.copy(); img[m == 0] = 0
    return cv2.resize(img, (256, 256))

manifest = json.load(open('avatars/manifest.json', encoding='utf-8'))
name_by_id = {m['id']: m['name'] for m in manifest}

orb = cv2.ORB_create(nfeatures=1000)
sift = cv2.SIFT_create()
bf_h = cv2.BFMatcher(cv2.NORM_HAMMING)
bf_l2 = cv2.BFMatcher(cv2.NORM_L2)

orb_des = {}
sift_des = {}
for m in manifest:
    av = circular(imread_unicode('avatars/%s.jpg' % m['id']), 48)
    k1, d1 = orb.detectAndCompute(av, None)
    k2, d2 = sift.detectAndCompute(av, None)
    if d1 is not None: orb_des[m['id']] = d1
    if d2 is not None: sift_des[m['id']] = d2

def score_all(det, bf, des_dict, q):
    kp, qdes = det.detectAndCompute(q, None)
    if qdes is None:
        return {hid: 0 for hid in des_dict}
    out = {}
    for hid, des in des_dict.items():
        ms = bf.knnMatch(qdes, des, k=2)
        good = [m for m, n in ms if m.distance < 0.75 * n.distance]
        out[hid] = len(good)
    return out

def evaluate(shot_path, circles, gt):
    shot = imread_unicode(shot_path)
    H, W = shot.shape[:2]
    results = {'orb': 0, 'sift': 0, 'combo': 0}
    for (cx, cy, r), g in zip(circles, gt):
        if g is None:
            continue
        sz = int(r * 2.2)
        x = max(0, cx - sz//2); y = max(0, cy - sz//2)
        x = min(x, W - sz); y = min(y, H - sz)
        q = circular(shot[y:y+sz, x:x+sz], sz)

        so = score_all(orb, bf_h, orb_des, q)
        ss = score_all(sift, bf_l2, sift_des, q)

        # 归一化后融合
        mo = max(so.values()) or 1
        ms = max(ss.values()) or 1
        combo = {h: so[h]/mo + ss[h]/ms for h in orb_des}

        if max(so, key=so.get) == g: results['orb'] += 1
        if max(ss, key=ss.get) == g: results['sift'] += 1
        if max(combo, key=combo.get) == g: results['combo'] += 1
    return results

# 截图1：runtime-screenshot.png（1517x1088）
c1 = [(43,41,25),(61,113,21),(85,61,22),(151,29,30),(197,31,31),(1375,43,26),(1423,37,29),(1435,115,23),(1471,43,26),(1481,115,17)]
g1 = ['xiangyu','yixing','cang','yuanliuzhizi_support','niumo','lixin','yunzhongjun','cang','zhugeliang','caocao']
r1 = evaluate('runtime-screenshot.png', c1, g1)
print('截图1 (runtime-screenshot.png):')
print('  ORB   :', r1['orb'], '/10')
print('  SIFT  :', r1['sift'], '/10')
print('  融合  :', r1['combo'], '/10')

# 截图2：测试用例（1920x864）
c2 = [(141,38,24),(197,37,23),(256,38,24),(313,37,23),(370,38,27),(1551,38,21),(1607,39,22),(1663,38,23),(1719,37,23),(1777,38,24)]
g2 = ['dunshan','donghuangtaiyi','yunyao','zhangliang',None,'kai','dayu','zhangliang','guanyu','sunquan']
r2 = evaluate('测试用例/62f73ca5e389165a91ac3fff2dab97a1.jpg', c2, g2)
print('截图2 (测试用例):')
print('  ORB   :', r2['orb'], '/9')
print('  SIFT  :', r2['sift'], '/9')
print('  融合  :', r2['combo'], '/9')
