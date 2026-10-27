# -*- coding: utf-8 -*-
# 分析 ban 界面：头像圆 + 下方锁图标的形态/颜色，为「锁图标模板检测」做准备
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

# 已知头像圆（runtime-screenshot.png）
CIRCLES = [(43,41,25),(61,113,21),(85,61,22),(151,29,30),(197,31,31),(1375,43,26),(1423,37,29),(1435,115,23),(1471,43,26),(1481,115,17)]

shot = imread_unicode('runtime-screenshot.png')
H, W = shot.shape[:2]
print('截图尺寸', W, 'x', H)

# 对每个头像，裁剪「头像+下方」区域，分析颜色和边缘
for i, (cx, cy, r) in enumerate(CIRCLES):
    # 头像下方区域：从圆底开始往下 70px
    y0 = max(0, cy + r)
    y1 = min(H, cy + r + 70)
    x0 = max(0, cx - 35)
    x1 = min(W, cx + 35)
    region = shot[y0:y1, x0:x1]
    if region.size == 0:
        continue
    # 转 HSV，找高饱和度区域（锁图标通常彩色/鲜艳）
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]
    # 高饱和度+中等亮度 = 可能的图标
    mask = (sat > 60) & (val > 60)
    n = int(mask.sum())
    if n > 0:
        ys, xs = np.where(mask)
        print(f'#{i} 头像({cx},{cy},r={r}) 下方彩色像素 {n} 个，范围 x[{xs.min()}..{xs.max()}] y[{ys.min()}..{ys.max()}] 均值BGR={region[mask].mean(axis=0).round().astype(int)}')
    else:
        print(f'#{i} 头像({cx},{cy},r={r}) 下方无明显彩色图标')

# 也检查头像圆环本身的颜色（边框环）
print('\n=== 头像圆环颜色分析 ===')
for i, (cx, cy, r) in enumerate(CIRCLES[:3]):
    # 在半径 r 附近采样一圈像素
    ring_px = []
    for ang in range(0, 360, 15):
        x = int(cx + (r + 2) * np.cos(np.radians(ang)))
        y = int(cy + (r + 2) * np.sin(np.radians(ang)))
        if 0 <= x < W and 0 <= y < H:
            ring_px.append(shot[y, x])
    ring_px = np.array(ring_px)
    print(f'#{i} 头像({cx},{cy},r={r}) 环像素均值BGR={ring_px.mean(axis=0).round().astype(int)}')
