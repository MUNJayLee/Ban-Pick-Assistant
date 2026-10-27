# -*- coding: utf-8 -*-
# 在已知头像下方搜索锁模板，验证锁的精确位置和匹配强度
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

shot = imread_unicode('runtime-screenshot.png')
H, W = shot.shape[:2]
gray = cv2.cvtColor(shot, cv2.COLOR_BGR2GRAY)

lock = imread_unicode('models/lock_0.png')
tpl = cv2.cvtColor(lock, cv2.COLOR_BGR2GRAY)

CIRCLES = [(43,41,25),(61,113,21),(85,61,22),(151,29,30),(197,31,31),(1375,43,26),(1423,37,29),(1435,115,23),(1471,43,26),(1481,115,17)]

for i, (cx, cy, r) in enumerate(CIRCLES):
    # 在头像下方一个搜索窗口内匹配锁
    # 窗口：x = cx ± 1.5r, y = cy + 0.5r 到 cy + 3r
    x0 = max(0, int(cx - 1.5*r))
    x1 = min(W, int(cx + 1.5*r))
    y0 = max(0, int(cy + 0.3*r))
    y1 = min(H, int(cy + 3*r))
    win = gray[y0:y1, x0:x1]
    if win.shape[0] < tpl.shape[0] or win.shape[1] < tpl.shape[1]:
        print(f'#{i} 头像({cx},{cy},r={r}) 窗口太小')
        continue
    res = cv2.matchTemplate(win, tpl, cv2.TM_CCOEFF_NORMED)
    _, maxv, _, maxloc = cv2.minMaxLoc(res)
    lx, ly = x0 + maxloc[0], y0 + maxloc[1]
    print(f'#{i} 头像({cx},{cy},r={r}) 锁最佳匹配 得分{maxv:.3f} 锁位置({lx},{ly}) 相对dy={(ly-cy)/r:.2f}r')
