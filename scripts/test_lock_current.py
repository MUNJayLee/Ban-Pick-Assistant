# -*- coding: utf-8 -*-
# 在用户当前 UI 的 ban 截图（62f73ca5...）上找灰白锁
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

shot = imread_unicode('测试用例/62f73ca5e389165a91ac3fff2dab97a1.jpg')
H, W = shot.shape[:2]
hsv = cv2.cvtColor(shot, cv2.COLOR_BGR2HSV)

# 头像位置（我方5 + 敌方5，单排）
CIRCLES = [(141,38,24),(197,37,23),(256,38,24),(313,37,23),(370,38,27),(1551,38,21),(1607,39,22),(1663,38,23),(1719,37,23),(1777,38,24)]

# 灰白锁：低饱和 + 高亮
s = hsv[:,:,1]; v = hsv[:,:,2]
gray_white = ((s < 70) & (v > 150)).astype(np.uint8)

print('=== 每个头像下沿灰白像素检查 ===')
for i, (cx, cy, r) in enumerate(CIRCLES):
    # 锁紧贴下沿、横跨内外：y 从 cy+r-6 到 cy+r+18，x 从 cx-r 到 cx+r
    y0 = max(0, cy + r - 6)
    y1 = min(H, cy + r + 18)
    x0 = max(0, cx - r)
    x1 = min(W, cx + r)
    region = gray_white[y0:y1, x0:x1]
    n = int(region.sum())
    print(f'  #{i} ({cx},{cy},r={r}) 下沿灰白像素 {n}')

# 全图顶部（上 12%）灰白连通域
top = gray_white[:int(H*0.12), :]
num, labels, stats, cents = cv2.connectedComponentsWithStats(top, 8)
print('\n=== 顶部灰白连通域（面积>=25，左右两侧）===')
for i in range(1, num):
    x, y, w, h, area = stats[i]
    cx, cy = cents[i]
    if area < 25:
        continue
    if cx < W*0.35 or cx > W*0.65:
        print(f'  ({int(cx)},{int(cy)}) 面积{area} {w}x{h}')
