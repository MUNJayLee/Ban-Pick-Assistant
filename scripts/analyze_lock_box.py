# -*- coding: utf-8 -*-
# 解析用户红框标注：找到红框（锁图标）的位置/大小/颜色
import cv2
import numpy as np
import glob

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

files = sorted(glob.glob('测试用例/锁示意图/*.png'))
for f in files:
    img = imread_unicode(f)
    H, W = img.shape[:2]
    print(f'\n=== {f} ({W}x{H}) ===')
    # 找红色框：R 高、G/B 低
    b, g, r = img[:, :, 0].astype(int), img[:, :, 1].astype(int), img[:, :, 2].astype(int)
    red_mask = (r > 150) & (g < 100) & (b < 100)
    ys, xs = np.where(red_mask)
    if len(xs) == 0:
        print('  未找到红框')
        continue
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    print(f'  红框范围: x[{x0}..{x1}] y[{y0}..{y1}]  尺寸 {x1-x0+1}x{y1-y0+1}')
    # 红框中心
    cx, cy = (x0+x1)//2, (y0+y1)//2
    print(f'  红框中心: ({cx},{cy})')
    # 红框内的内容（去掉红框线，取内部区域的颜色特征）
    inner = img[y0+3:y1-2, x0+3:x1-2]
    if inner.size > 0:
        mean_bgr = inner.reshape(-1,3).mean(axis=0)
        print(f'  框内平均BGR: {mean_bgr.round().astype(int)}')
        # 框内主要颜色（HSV）
        hsv = cv2.cvtColor(inner, cv2.COLOR_BGR2HSV)
        print(f'  框内平均HSV: {hsv.reshape(-1,3).mean(axis=0).round().astype(int)}')
    # 保存红框区域（含框线）
    crop = img[y0:y1+1, x0:x1+1]
    cv2.imwrite(f.replace('锁示意图', '锁示意图').replace('.png', '_box.png'), crop)
