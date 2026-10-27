# -*- coding: utf-8 -*-
# 测试不同特征算子（ORB/AKAZE/SIFT/BRISK）在测试用例上的识别准确率
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

SHOT = '测试用例/62f73ca5e389165a91ac3fff2dab97a1.jpg'
# 该图检测到的 10 个圆（来自 Python 脚本输出 pos）
CIRCLES = [(141,38,24),(197,37,23),(256,38,24),(313,37,23),(370,38,27),(1551,38,21),(1607,39,22),(1663,38,23),(1719,37,23),(1777,38,24)]
GT = ['dunshan','donghuangtaiyi','yunyao','zhangliang',None,'kai','dayu','zhangliang','guanyu','sunquan']

manifest = json.load(open('avatars/manifest.json', encoding='utf-8'))
name_by_id = {m['id']: m['name'] for m in manifest}

shot = imread_unicode(SHOT)
H, W = shot.shape[:2]

def run(detector_name):
    if detector_name == 'ORB':
        det = cv2.ORB_create(nfeatures=1000)
    elif detector_name == 'AKAZE':
        det = cv2.AKAZE_create()
    elif detector_name == 'SIFT':
        det = cv2.SIFT_create()
    elif detector_name == 'BRISK':
        det = cv2.BRISK_create()
    norm = cv2.NORM_HAMMING if detector_name in ('ORB','AKAZE','BRISK') else cv2.NORM_L2
    bf = cv2.BFMatcher(norm)

    av_des = {}
    for m in manifest:
        av = circular(imread_unicode('avatars/%s.jpg' % m['id']), 48)
        kp, des = det.detectAndCompute(av, None)
        if des is not None:
            av_des[m['id']] = des

    correct = 0
    details = []
    for (cx, cy, r), gt in zip(CIRCLES, GT):
        if gt is None:
            continue
        sz = int(r * 2.2)
        x = max(0, cx - sz//2); y = max(0, cy - sz//2)
        x = min(x, W - sz); y = min(y, H - sz)
        q = circular(shot[y:y+sz, x:x+sz], sz)
        kp, qdes = det.detectAndCompute(q, None)
        if qdes is None:
            details.append(f'{gt}: 无特征')
            continue
        scores = []
        for hid, des in av_des.items():
            ms = bf.knnMatch(qdes, des, k=2)
            good = [m for m, n in ms if m.distance < 0.75 * n.distance]
            scores.append((hid, len(good)))
        scores.sort(key=lambda x: -x[1])
        top = scores[0][0] if scores else None
        rank = next((i for i, (h, _) in enumerate(scores) if h == gt), -1)
        ok = top == gt
        if ok:
            correct += 1
        details.append(f'{gt}({name_by_id.get(gt,"")}) -> {name_by_id.get(top, top)} rank{rank+1} score{scores[0][1] if scores else 0} {"OK" if ok else "FAIL"}')
    return correct, details

for name in ['ORB', 'SIFT']:
    try:
        c, d = run(name)
        print(f'\n=== {name} === 准确率 {c}/9')
        for line in d:
            print(' ', line)
    except Exception as e:
        print(f'\n=== {name} === 失败: {e}')
