# -*- coding: utf-8 -*-
# 跨头像边缘一致性：ban 头像下方若有一个固定形状（锁），多个头像该区域边缘应高度相关
import cv2
import numpy as np

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

shot = imread_unicode('runtime-screenshot.png')
H, W = shot.shape[:2]
gray = cv2.cvtColor(shot, cv2.COLOR_BGR2GRAY)

# 已知头像圆（左方5个 + 右方5个）
CIRCLES = [(43,41,25),(61,113,21),(85,61,22),(151,29,30),(197,31,31),(1375,43,26),(1423,37,29),(1435,115,23),(1471,43,26),(1481,115,17)]

# 对每个头像，提取「正下方」一个 50x50 区域（从圆底开始往下）
regions = []
for (cx, cy, r) in CIRCLES:
    x0 = int(cx - 25)
    y0 = int(cy + r)  # 圆底
    x1, y1 = x0 + 50, y0 + 50
    if x0 < 0 or y1 > H or x1 > W:
        continue
    roi = gray[y0:y1, x0:x1]
    roi = cv2.resize(roi, (50, 50))
    regions.append(roi)

print('提取到', len(regions), '个下方区域')

# 两两比较边缘图的归一化互相关
def edge(roi):
    e = cv2.Canny(roi, 50, 150)
    return e.astype(np.float32)

edges = [edge(r) for r in regions]
print('\n边缘图两两相关系数（高=固定形状一致）:')
for i in range(len(edges)):
    corrs = []
    for j in range(len(edges)):
        if i == j:
            continue
        a = edges[i] - edges[i].mean()
        b = edges[j] - edges[j].mean()
        denom = (np.linalg.norm(a) * np.linalg.norm(b)) + 1e-8
        corrs.append(float((a * b).sum() / denom))
    print(f'  头像#{i}: 平均相关 {np.mean(corrs):.3f}  max {max(corrs):.3f}')

# 平均边缘图（固定形状会突出，随机内容会模糊）
avg_edge = np.mean(edges, axis=0)
print('\n平均边缘图非零像素占比:', (avg_edge > 0.15 * 255).mean())
# 保存平均边缘图和第一张下方区域图，供人工确认
cv2.imwrite('_lock_avg_edge.png', (avg_edge * 255).astype(np.uint8))
cv2.imwrite('_lock_region0.png', regions[0])
print('已保存 _lock_avg_edge.png / _lock_region0.png')
