# -*- coding: utf-8 -*-
# 锁检测 → 头像中心 的换算关系验证
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

shot = imread_unicode('测试用例/62f73ca5e389165a91ac3fff2dab97a1.jpg')
H, W = shot.shape[:2]
hsv = cv2.cvtColor(shot, cv2.COLOR_BGR2HSV)
s = hsv[:,:,1]; v = hsv[:,:,2]
gray_white = ((s < 70) & (v > 150)).astype(np.uint8)
gray_white = cv2.morphologyEx(gray_white, cv2.MORPH_OPEN, np.ones((2,2), np.uint8))
top = gray_white[:int(H*0.12), :]

num, labels, stats, cents = cv2.connectedComponentsWithStats(top, 8)

# 真实头像中心
GT = [(141,38,24),(197,37,23),(256,38,24),(313,37,23),(370,38,27),(1551,38,21),(1607,39,22),(1663,38,23),(1719,37,23),(1777,38,24)]

# 收集候选锁（尺寸 ~10-22px，宽高比 0.6-1.6，左右两侧）
candidates = []
for i in range(1, num):
    x, y, w, h, area = stats[i]
    cx, cy = cents[i]
    if area < 50 or area > 500:
        continue
    if not (0.6 < w / max(h,1) < 1.6):
        continue
    if cx < W*0.35 or cx > W*0.65:
        candidates.append((x, y, w, h, area, cx, cy))

candidates.sort(key=lambda c: c[0])
print('候选锁数量:', len(candidates))
for x, y, w, h, area, cx, cy in candidates:
    # 尝试换算：头像半径 r ≈ 1.6*w，头像中心在锁上方
    r = 1.6 * w
    ax = cx - 0.43 * w
    ay = y - r - 1
    # 找最近的真实头像
    best = min(GT, key=lambda g: (g[0]-ax)**2 + (g[1]-ay)**2)
    err = ((best[0]-ax)**2 + (best[1]-ay)**2) ** 0.5
    print(f'  锁({x},{y}) {w}x{h} -> 推算头像({ax:.0f},{ay:.0f},r={r:.0f}) 最近真实({best[0]},{best[1]},r={best[2]}) 误差{err:.1f}px')
