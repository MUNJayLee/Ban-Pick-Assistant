# -*- coding: utf-8 -*-
# 提取锁图标模板并测试模板匹配，找到 ban 头像下方所有锁图标
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

shot = imread_unicode('runtime-screenshot.png')
H, W = shot.shape[:2]

# 参考：第一个头像 (43,41,r=25)，锁在其正下方
# 根据颜色分析，锁大概在 y=95..135, x=20..77（绝对坐标）
cx, cy, r = 43, 41, 25
x0, y0, x1, y1 = 15, 80, 85, 140
template = shot[y0:y1, x0:x1].copy()
print('模板尺寸', template.shape)
cv2.imwrite('_lock_template.png', template)

# 灰度 + 模板匹配
gray = cv2.cvtColor(shot, cv2.COLOR_BGR2GRAY)
tpl = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
res = cv2.matchTemplate(gray, tpl, cv2.TM_CCOEFF_NORMED)

# 找局部极大值（类似腾讯论文：max filter + NMS）
th, tw = tpl.shape
res2 = res.copy()
# 非极大值抑制：只保留比周围都大的点
for _ in range(2):
    res_dil = cv2.dilate(res2, np.ones((25, 25), np.uint8))
    res2 = np.where(res2 == res_dil, res2, res2 * 0.5)

# 取 top 20
flat = res2.flatten()
top_idx = np.argsort(flat)[::-1][:20]
print('\n匹配得分 top20:')
seen = []
for idx in top_idx:
    y, x = divmod(idx, W)
    score = float(res[y, x])
    if score < 0.3:
        continue
    # 简单 NMS
    too_close = any(abs(x - sx) < 40 and abs(y - sy) < 40 for sx, sy in seen)
    if too_close:
        continue
    seen.append((x, y))
    print(f'  ({x},{y}) 得分 {score:.3f}  -> 头像约在 ({x+tw//2},{y - 25})')
