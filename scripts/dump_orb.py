# -*- coding: utf-8 -*-
# 输出 ake.jpg 经 circular(48) 后的 ORB 关键点数和描述子摘要
import cv2
import numpy as np

def circular(img, size):
    img = cv2.resize(img, (size, size))
    m = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(m, (size//2, size//2), size//2, 255, -1)
    img = img.copy(); img[m == 0] = 0
    return cv2.resize(img, (256, 256))

av = cv2.imdecode(np.fromfile('avatars/ake.jpg', dtype=np.uint8), cv2.IMREAD_COLOR)
cir = circular(av, 48)
orb = cv2.ORB_create(nfeatures=1000)
kp, des = orb.detectAndCompute(cir, None)
print('keypoints:', len(kp))
print('descriptor shape:', des.shape if des is not None else None)
if des is not None:
    print('first desc (16 bytes):', ' '.join(str(int(b)) for b in des[0][:16]))
    print('desc sum:', int(des.sum()))
# 输出圆形图灰度直方信息，用于对照
gray = cv2.cvtColor(cir, cv2.COLOR_BGR2GRAY)
print('gray[0,0]=', int(gray[0,0]), 'gray[128,128]=', int(gray[128,128]), 'gray[100,50]=', int(gray[100,50]))
print('gray sum:', int(gray.sum()))
