# -*- coding: utf-8 -*-
# 用灰白色（高亮度、低饱和）定位头像下沿的挂锁
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

shot = imread_unicode('runtime-screenshot.png')
H, W = shot.shape[:2]
hsv = cv2.cvtColor(shot, cv2.COLOR_BGR2HSV)

# 灰白色：低饱和 + 高亮度
s = hsv[:, :, 1]
v = hsv[:, :, 2]
gray_white = (s < 60) & (v > 160)
gray_white = cv2.morphologyEx(gray_white.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2,2), np.uint8))

# 只关注顶部区域（上 15%）的左右两侧
top = gray_white[:int(H*0.15), :]

num, labels, stats, cents = cv2.connectedComponentsWithStats(top, 8)
print('顶部灰白连通域:', num - 1)
found = []
for i in range(1, num):
    x, y, w, h, area = stats[i]
    cx, cy = cents[i]
    if area < 30:
        continue
    if cx < W*0.35 or cx > W*0.65:
        found.append((int(cx), int(cy), area, w, h))
found.sort(key=lambda a: -a[2])
print('左右两侧灰白块（按面积降序）:')
for cx, cy, area, w, h in found[:25]:
    print(f'  ({cx},{cy}) 面积{area} {w}x{h}')

# 已知头像位置，检查每个头像下沿有没有灰白块
print('\n=== 头像下沿灰白检查 ===')
CIRCLES = [(43,41,25),(61,113,21),(85,61,22),(151,29,30),(197,31,31),(1375,43,26),(1423,37,29),(1435,115,23),(1471,43,26),(1481,115,17)]
for cx, cy, r in CIRCLES:
    # 下沿区域：y 从 cy+r-8 到 cy+r+20，x 从 cx-r 到 cx+r
    y0 = max(0, cy + r - 8)
    y1 = min(H, cy + r + 20)
    x0 = max(0, cx - r)
    x1 = min(W, cx + r)
    region = gray_white[y0:y1, x0:x1]
    n = int(region.sum())
    print(f'  头像({cx},{cy},r={r}) 下沿灰白像素 {n} 个')
