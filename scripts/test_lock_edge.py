# -*- coding: utf-8 -*-
# 检查头像下沿区域的真实像素值，理解灰白锁的亮度范围
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

shot = imread_unicode('runtime-screenshot.png')
H, W = shot.shape[:2]

# 头像 #4 (151,29,r=30) 和 #5 (197,31,r=31) 是右侧两个，下方锁应该明显
# 先看头像 #4 下沿一行像素
cx, cy, r = 151, 29, 30
print(f'头像#4 ({cx},{cy},r={r})，底边 y={cy+r}={cy+r}')
for dy in range(-10, 25):
    y = cy + r + dy
    if y < 0 or y >= H:
        continue
    row = shot[y, cx-r:cx+r]
    mean_bgr = row.mean(axis=0).round().astype(int)
    # 灰白 = R≈G≈B 且较亮
    diff = abs(int(row[:,0].mean()) - int(row[:,2].mean()))
    print(f'  y={y} (dy={dy:+d}) 平均BGR={mean_bgr} 亮度≈{int(row.mean())} R-B差={diff}')
