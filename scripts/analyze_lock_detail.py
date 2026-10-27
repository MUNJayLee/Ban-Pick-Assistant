# -*- coding: utf-8 -*-
# 详细分析：头像圆 + 红框锁的相对位置，以及锁本身的形态
import cv2
import numpy as np
import glob

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

files = sorted(glob.glob('测试用例/锁示意图/*.png'))
for f in files:
    img = imread_unicode(f)
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    print(f'\n=== {f.split(chr(92))[-1]} ({W}x{H}) ===')

    # 1. 找红框（锁）
    b, g, r = img[:, :, 0].astype(int), img[:, :, 1].astype(int), img[:, :, 2].astype(int)
    red_mask = (r > 150) & (g < 100) & (b < 100)
    ys, xs = np.where(red_mask)
    if len(xs):
        lx0, lx1, ly0, ly1 = xs.min(), xs.max(), ys.min(), ys.max()
        print(f'  锁框: x[{lx0}..{lx1}] y[{ly0}..{ly1}] 尺寸 {lx1-lx0+1}x{ly1-ly0+1} 中心({(lx0+lx1)//2},{(ly0+ly1)//2})')
    else:
        lx0 = lx1 = ly0 = ly1 = None
        print('  未找到红框')

    # 2. 找头像圆（HoughCircles，去掉红色框线干扰）
    img_nored = img.copy()
    if lx0 is not None:
        img_nored[red_mask] = (0, 0, 0)
    gray2 = cv2.cvtColor(img_nored, cv2.COLOR_BGR2GRAY)
    circles = cv2.HoughCircles(gray2, cv2.HOUGH_GRADIENT, 1.2, 30, 100, 30, 10, 100)
    if circles is not None:
        cs = np.uint16(np.around(circles[0]))
        for (cx, cy, r) in cs[:3]:
            print(f'  头像圆: 中心({cx},{cy}) 半径{r}')
            if lx0 is not None:
                # 锁相对头像的位置（锁中心 - 头像中心，除以半径）
                dx = ((lx0+lx1)//2 - cx) / r
                dy = ((ly0+ly1)//2 - cy) / r
                print(f'    -> 锁相对头像中心: dx={dx:.2f}r dy={dy:.2f}r')
                # 锁尺寸相对头像半径
                lw = (lx1-lx0+1) / (2*r)
                lh = (ly1-ly0+1) / (2*r)
                print(f'    -> 锁尺寸(相对直径): {lw:.2f} x {lh:.2f}')

    # 3. 锁区域本身的颜色/形状（去掉红框线）
    if lx0 is not None:
        inner = img[ly0+4:ly1-3, lx0+4:lx1-3]
        if inner.size > 0:
            hsv = cv2.cvtColor(inner, cv2.COLOR_BGR2HSV)
            # 主要色相
            h = hsv[:,:,0].flatten()
            s = hsv[:,:,1].flatten()
            sat_px = h[s > 60]
            if len(sat_px):
                hist = np.histogram(sat_px, bins=12, range=(0,180))[0]
                top_h = (hist.argmax() * 15 + 7)
                print(f'  锁主色相(H)≈{top_h} (0红 60绿 120蓝) 高饱和像素占比 {len(sat_px)/len(h):.2f}')
            else:
                print('  锁无高饱和像素(偏灰白)')
