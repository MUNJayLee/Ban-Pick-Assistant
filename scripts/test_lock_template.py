# -*- coding: utf-8 -*-
# 从红框提取锁模板，在完整截图里做模板匹配，验证锁的位置
import cv2
import numpy as np
import glob

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

# 提取锁模板（取第一张图红框内部）
crop = imread_unicode('测试用例/锁示意图/Snipaste_2026-08-25_20-35-46.png')
b, g, r = crop[:, :, 0].astype(int), crop[:, :, 1].astype(int), crop[:, :, 2].astype(int)
red_mask = (r > 150) & (g < 100) & (b < 100)
ys, xs = np.where(red_mask)
lx0, lx1, ly0, ly1 = xs.min(), xs.max(), ys.min(), ys.max()
lock = crop[ly0+4:ly1-3, lx0+4:lx1-3]  # 去掉红框线
print('锁模板尺寸:', lock.shape)
cv2.imwrite('models/lock_template.png', lock)

# 在完整截图里匹配
shot = imread_unicode('runtime-screenshot.png')
H, W = shot.shape[:2]
gray = cv2.cvtColor(shot, cv2.COLOR_BGR2GRAY)
tpl_gray = cv2.cvtColor(lock, cv2.COLOR_BGR2GRAY)

# 多尺度匹配：把模板缩放到不同大小
best_matches = []
for scale in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
    tw = max(8, int(tpl_gray.shape[1] * scale))
    th = max(8, int(tpl_gray.shape[0] * scale))
    t = cv2.resize(tpl_gray, (tw, th))
    if t.shape[0] > H or t.shape[1] > W:
        continue
    res = cv2.matchTemplate(gray, t, cv2.TM_CCOEFF_NORMED)
    _, maxv, _, maxloc = cv2.minMaxLoc(res)
    best_matches.append((maxv, scale, maxloc))

best_matches.sort(reverse=True)
print('\n各尺度最佳匹配得分:')
for maxv, scale, (x, y) in best_matches[:5]:
    tw = int(tpl_gray.shape[1] * scale)
    th = int(tpl_gray.shape[0] * scale)
    print(f'  scale={scale:.1f} 得分={maxv:.3f} 位置=({x},{y}) 头像约在({x+tw//2},{y-th//2})')

# 用最佳尺度，做全图 NMS 检测所有锁
if best_matches:
    _, best_scale, _ = best_matches[0]
    tw = max(8, int(tpl_gray.shape[1] * best_scale))
    th = max(8, int(tpl_gray.shape[0] * best_scale))
    t = cv2.resize(tpl_gray, (tw, th))
    res = cv2.matchTemplate(gray, t, cv2.TM_CCOEFF_NORMED)
    # 局部极大值 + NMS
    seen = []
    print(f'\n用 scale={best_scale:.1f} 检测锁位置:')
    for _ in range(20):
        _, maxv, _, maxloc = cv2.minMaxLoc(res)
        x, y = maxloc
        if maxv < 0.4:
            break
        if any(abs(x-sx) < 30 and abs(y-sy) < 30 for sx, sy in seen):
            res[y-th//2:y+th//2, x-tw//2:x+tw//2] = 0
            continue
        seen.append((x, y))
        print(f'  锁({x},{y}) 得分{maxv:.3f} -> 头像中心约({x+tw//2},{y - th})')
        res[y-th//2:y+th//2, x-tw//2:x+tw//2] = 0
