# -*- coding: utf-8 -*-
# 测试 MobileNetV2 特征提取 + 余弦相似度检索，对比 ORB 在三张截图上的准确率
import json
import cv2
import numpy as np

FEAT_LAYER = 'mobilenetv20_features_pool0_fwd'

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

def preprocess(img):
    """224x224 + ImageNet 归一化（BGR->RGB）"""
    img = cv2.resize(img, (224, 224))
    blob = cv2.dnn.blobFromImage(img, 1/255.0, (224, 224), (0.485, 0.456, 0.406), swapRB=True, crop=False)
    return blob

def feat(net, img):
    net.setInput(preprocess(img))
    out = net.forward(FEAT_LAYER)
    v = out.flatten().astype(np.float32)
    v = v / (np.linalg.norm(v) + 1e-8)
    return v

def circular(img, size):
    img = cv2.resize(img, (size, size))
    m = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(m, (size//2, size//2), size//2, 255, -1)
    img = img.copy(); img[m == 0] = 0
    return cv2.resize(img, (256, 256))

def main():
    net = cv2.dnn.readNetFromONNX('models/mobilenetv2-7.onnx')
    manifest = json.load(open('avatars/manifest.json', encoding='utf-8'))
    name_by_id = {m['id']: m['name'] for m in manifest}
    ids = [m['id'] for m in manifest]

    # 构建参考特征（官方头像）
    ref = {}
    for m in manifest:
        av = circular(imread_unicode('avatars/%s.jpg' % m['id']), 48)
        ref[m['id']] = feat(net, av)
    print('参考特征已构建:', len(ref))

    def recognize(shot_path, circles, gt):
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
            q = circular(shot[y:y+sz, x:x+sz], sz)
            qf = feat(net, q)
            # 余弦相似度
            sims = {hid: float(np.dot(qf, ref[hid])) for hid in ids}
            top = sorted(sims.items(), key=lambda x: -x[1])
            ok = top[0][0] == g
            if ok:
                correct += 1
            rank = next((i for i, (h, _) in enumerate(top) if h == g), -1)
            details.append(f'{g} -> {name_by_id[top[0][0]]} rank{rank+1} sim{top[0][1]:.3f} {"OK" if ok else "FAIL"}')
        return correct, total, details

    # 截图1
    c1 = [(43,41,25),(61,113,21),(85,61,22),(151,29,30),(197,31,31),(1375,43,26),(1423,37,29),(1435,115,23),(1471,43,26),(1481,115,17)]
    g1 = ['xiangyu','yixing','cang','yuanliuzhizi_support','niumo','lixin','yunzhongjun','cang','zhugeliang','caocao']
    r1 = recognize('runtime-screenshot.png', c1, g1)
    print(f'\n截图1: {r1[0]}/{r1[1]}')
    for d in r1[2]: print(' ', d)

    # 截图2
    c2 = [(141,38,24),(197,37,23),(256,38,24),(313,37,23),(370,38,27),(1551,38,21),(1607,39,22),(1663,38,23),(1719,37,23),(1777,38,24)]
    g2 = ['dunshan','donghuangtaiyi','yunyao','zhangliang',None,'kai','dayu','zhangliang','guanyu','sunquan']
    r2 = recognize('测试用例/62f73ca5e389165a91ac3fff2dab97a1.jpg', c2, g2)
    print(f'\n截图2: {r2[0]}/{r2[1]}')
    for d in r2[2]: print(' ', d)

if __name__ == '__main__':
    main()
