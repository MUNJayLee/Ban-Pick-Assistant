# -*- coding: utf-8 -*-
# 对比 cv2 解码 ake.jpg 的灰度值，供与 sharp 对照
import cv2
import numpy as np

img = cv2.imdecode(np.fromfile('avatars/ake.jpg', dtype=np.uint8), cv2.IMREAD_COLOR)
print('cv2 shape:', img.shape)
pts = [(0, 0), (10, 10), (25, 25), (50, 50), (50, 99), (99, 99)]
for x, y in pts:
    B, G, R = int(img[y, x, 0]), int(img[y, x, 1]), int(img[y, x, 2])
    gray = int(round(0.299 * R + 0.587 * G + 0.114 * B))
    print(f'({x},{y}) R={R} G={G} B={B} gray={gray}')
