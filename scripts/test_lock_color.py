# -*- coding: utf-8 -*-
# 用颜色（橙金色锁）定位 ban 头像下方的锁图标
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

shot = imread_unicode('runtime-screenshot.png')
H, W = shot.shape[:2]
hsv = cv2.cvtColor(shot, cv2.COLOR_BGR2HSV)

# 橙金色范围（锁/禁 图标常见颜色）
low = np.array([10, 80, 80])
high = np.array([30, 255, 255])
mask = cv2.inRange(hsv, low, high)
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3,3), np.uint8))

# 只在顶部区域（上 15%）查找
top = mask[0:int(H*0.15), :]

# 找连通域
num, labels, stats, cents = cv2.connectedComponentsWithStats(top, 8)
print('橙金区域连通域:', num - 1)
for i in range(1, num):
    x, y, w, h, area = stats[i]
    cx, cy = cents[i]
    if area < 15:
        continue
    if cx < W*0.35 or cx > W*0.65:  # 只关注左右两侧
        print(f'  连通域 面积={area} 中心=({int(cx)},{int(cy)}) 尺寸={w}x{h} 左上=({x},{y})')
