# -*- coding: utf-8 -*-
# 分别用蓝色（左方）/红色（右方）定位 ban 头像下方的锁/禁标识
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

shot = imread_unicode('runtime-screenshot.png')
H, W = shot.shape[:2]
hsv = cv2.cvtColor(shot, cv2.COLOR_BGR2HSV)

def find_clusters(mask, region_name):
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3,3), np.uint8))
    num, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    print(f'== {region_name} ==')
    for i in range(1, num):
        x, y, w, h, area = stats[i]
        cx, cy = cents[i]
        if area < 20:
            continue
        print(f'  面积={area} 中心=({int(cx)},{int(cy)}) 尺寸={w}x{h} 左上=({x},{y})')

# 蓝色（左方 ban 标识）
blue_low = np.array([100, 60, 60])
blue_high = np.array([130, 255, 255])
blue_mask = cv2.inRange(hsv, blue_low, blue_high)
find_clusters(blue_mask[:, :int(W*0.35)], '蓝色(左方)')

# 红色（右方 ban 标识）—— 红在 HSV 里跨 0 附近
red1 = cv2.inRange(hsv, np.array([0, 60, 60]), np.array([12, 255, 255]))
red2 = cv2.inRange(hsv, np.array([168, 60, 60]), np.array([180, 255, 255]))
red_mask = cv2.bitwise_or(red1, red2)
find_clusters(red_mask[:, int(W*0.65):], '红色(右方)')
