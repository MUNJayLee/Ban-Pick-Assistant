# -*- coding: utf-8 -*-
# 逐档输出 cv2 HoughCircles 检测到的圆（对照 WASM）
import cv2
import numpy as np

shot = cv2.imdecode(np.fromfile('runtime-screenshot.png', dtype=np.uint8), cv2.IMREAD_COLOR)
H, W = shot.shape[:2]
gray = cv2.cvtColor(shot, cv2.COLOR_BGR2GRAY)
top = gray[0:int(H*0.12), :]
for (md, p1, p2, mnr, mxr) in [(50, 100, 30, 18, 30), (40, 90, 22, 17, 32), (40, 80, 15, 15, 34)]:
    circles = cv2.HoughCircles(top, cv2.HOUGH_GRADIENT, dp=1.2, minDist=md, param1=p1, param2=p2, minRadius=mnr, maxRadius=mxr)
    n = 0 if circles is None else circles.shape[1]
    valid = []
    if circles is not None:
        cs = np.uint16(np.around(circles[0]))
        for c in cs:
            x, y, r = int(c[0]), int(c[1]), int(c[2])
            if r >= 17 and (x < W*0.35 or x > W*0.65):
                valid.append((x, y, r))
    print(f'params({md},{p1},{p2},{mnr},{mxr}): raw={n} valid={len(valid)}')
    for v in sorted(valid, key=lambda c: c[0]):
        print('   ', v)
