# -*- coding: utf-8 -*-
# 用「同一高度 + 等距」双重约束找锁行，用等距均匀度区分锁行与头像内容
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

blobs = []
for i in range(1, num):
    x, y, w, h, area = stats[i]
    cx, cy = cents[i]
    if area < 50 or area > 600:
        continue
    if not (0.5 < w/max(h,1) < 2.0):
        continue
    blobs.append((x, y, w, h, cx, cy))

GT = [(141,38,24),(197,37,23),(256,38,24),(313,37,23),(370,38,27),(1551,38,21),(1607,39,22),(1663,38,23),(1719,37,23),(1777,38,24)]

def spacing_uniformity(blobs):
    """x 间距的均匀度（变异系数，越小越均匀）"""
    xs = sorted(b[0] for b in blobs)
    if len(xs) < 3:
        return 999
    gaps = [xs[i+1]-xs[i] for i in range(len(xs)-1)]
    return float(np.std(gaps) / (np.mean(gaps) + 1e-8))

def find_row(blobs):
    """找「同一高度」的锁行：按 y 聚类，选等距最均匀、数量最多的簇"""
    if not blobs:
        return []
    best = []
    best_score = 999
    # 按 y 聚类（每个 blob 作为聚类中心，±12px）
    ys = sorted(set(int(b[1]) for b in blobs))
    for y0 in ys:
        cluster = [b for b in blobs if abs(b[1] - y0) <= 12]
        if len(cluster) < 3:
            continue
        uni = spacing_uniformity(cluster)
        # 分数：优先等距均匀，其次数量多
        score = uni * 100 - len(cluster)
        if score < best_score:
            best_score = score
            best = cluster
    best.sort(key=lambda b: b[0])
    return best

for name, side_blobs, side_gt in [('左', [b for b in blobs if b[4] < W*0.35], GT[:5]),
                                   ('右', [b for b in blobs if b[4] > W*0.65], GT[5:])]:
    row = find_row(side_blobs)
    print(f'\n== {name}方 锁行（{len(row)} 个）==')
    for x, y, w, h, cx, cy in row:
        r = 1.6 * w
        ax = cx - 0.43 * w
        ay = y - r - 1
        best = min(side_gt, key=lambda g: (g[0]-ax)**2 + (g[1]-ay)**2)
        err = ((best[0]-ax)**2 + (best[1]-ay)**2) ** 0.5
        print(f'  锁({x},{y}) {w}x{h} -> 头像({ax:.0f},{ay:.0f}) 最近真实({best[0]},{best[1]}) 误差{err:.0f}px')
    xs = [b[0] for b in row]
    if len(xs) >= 2:
        gaps = [xs[i+1]-xs[i] for i in range(len(xs)-1)]
        print(f'  x 间距: {gaps}  平均 {np.mean(gaps):.1f}')
