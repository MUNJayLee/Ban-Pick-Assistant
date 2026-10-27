# -*- coding: utf-8 -*-
# 用小连通域（锁约 14-20px，头像内容是大块）+ 颜色定位锁
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

shot = imread_unicode('runtime-screenshot.png')
H, W = shot.shape[:2]
hsv = cv2.cvtColor(shot, cv2.COLOR_BGR2HSV)

def find_locks(mask, name):
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2,2), np.uint8))
    num, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    print(f'== {name} (面积 40~600 的小块) ==')
    found = []
    for i in range(1, num):
        x, y, w, h, area = stats[i]
        cx, cy = cents[i]
        if area < 40 or area > 600:  # 锁是中等大小块
            continue
        found.append((int(cx), int(cy), area, w, h))
    found.sort(key=lambda a: -a[2])
    for cx, cy, area, w, h in found[:15]:
        print(f'  ({cx},{cy}) 面积{area} {w}x{h}')

# 蓝色锁（左方）：H 85~135（青蓝），高饱和
blue = cv2.inRange(hsv, np.array([85, 60, 60]), np.array([135, 255, 255]))
find_locks(blue[:, :int(W*0.35)], '蓝色小块(左方)')

# 红色锁（右方）：H 0~15 或 165~180
red1 = cv2.inRange(hsv, np.array([0, 60, 60]), np.array([15, 255, 255]))
red2 = cv2.inRange(hsv, np.array([165, 60, 60]), np.array([180, 255, 255]))
red = cv2.bitwise_or(red1, red2)
find_locks(red[:, int(W*0.65):], '红色小块(右方)')
