# -*- coding: utf-8 -*-
# 验证并利用「锁等距排列 + 同一高度」的规律，做锁行检测
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

# 收集灰白块（锁候选：面积、宽高比适中）
blobs = []
for i in range(1, num):
    x, y, w, h, area = stats[i]
    cx, cy = cents[i]
    if area < 50 or area > 600:
        continue
    if not (0.5 < w/max(h,1) < 2.0):
        continue
    blobs.append((x, y, w, h, area, cx, cy))

# 真实头像（ground truth）
GT = [(141,38,24),(197,37,23),(256,38,24),(313,37,23),(370,38,27),(1551,38,21),(1607,39,22),(1663,38,23),(1719,37,23),(1777,38,24)]

def find_row(blobs):
    """找「同一高度 + 等距」的锁行，返回该行的 blob（按 x 排序）"""
    if not blobs:
        return []
    # 按 y 聚类：锁行在同一高度
    ys = sorted(set(int(b[1]) for b in blobs))
    # 找 y 值最多的窄区间
    best_y = None
    best_cnt = 0
    for y in ys:
        cnt = sum(1 for b in blobs if abs(b[1] - y) <= 10)
        if cnt > best_cnt:
            best_cnt = cnt
            best_y = y
    row = [b for b in blobs if abs(b[1] - best_y) <= 10]
    row.sort(key=lambda b: b[0])
    return row

left_blobs = [b for b in blobs if b[5] < W*0.35]
right_blobs = [b for b in blobs if b[5] > W*0.65]

for name, side_blobs, side_gt in [('左', left_blobs, GT[:5]), ('右', right_blobs, GT[5:])]:
    row = find_row(side_blobs)
    print(f'\n== {name}方 锁行（{len(row)} 个）==')
    for x, y, w, h, area, cx, cy in row:
        # 推算头像
        r = 1.6 * w
        ax = cx - 0.43 * w
        ay = y - r - 1
        best = min(side_gt, key=lambda g: (g[0]-ax)**2 + (g[1]-ay)**2)
        err = ((best[0]-ax)**2 + (best[1]-ay)**2) ** 0.5
        print(f'  锁({x},{y}) {w}x{h} -> 头像({ax:.0f},{ay:.0f}) 最近真实({best[0]},{best[1]}) 误差{err:.0f}px')
    # 等距检查
    xs = [b[0] for b in row]
    if len(xs) >= 2:
        gaps = [xs[i+1]-xs[i] for i in range(len(xs)-1)]
        print(f'  x 间距: {gaps}  平均 {np.mean(gaps):.1f}')
