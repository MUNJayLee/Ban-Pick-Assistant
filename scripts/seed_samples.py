# -*- coding: utf-8 -*-
# 冷启动播种：把已知答案的测试截图裁剪成训练样本，写入 training_samples 表。
# 用法: python scripts/seed_samples.py
import json
import base64
import urllib.request
import cv2
import numpy as np

SUPABASE_URL = 'https://nvgvaphzhqgsbxqrfoyb.supabase.co'
PUBLISHABLE_KEY = 'sb_publishable_DJHwKetxg1LHNFdwlhF6jA_eQ88lwaZ'


def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def crop_square(shot, cx, cy, r, size=96):
    """与前端一致的方形裁剪（不含圆形掩码）"""
    sz = int(r * 2.2)
    x = max(0, cx - sz // 2)
    y = max(0, cy - sz // 2)
    x = min(x, shot.shape[1] - sz)
    y = min(y, shot.shape[0] - sz)
    roi = shot[y:y + sz, x:x + sz]
    roi = cv2.resize(roi, (size, size))
    ok, buf = cv2.imencode('.jpg', roi, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buf).decode('ascii') if ok else None


def insert_sample(hero_id, b64):
    req = urllib.request.Request(
        SUPABASE_URL + '/rest/v1/training_samples',
        data=json.dumps({'hero_id': hero_id, 'image_b64': b64, 'source': 'seed'}).encode('utf-8'),
        headers={'apikey': PUBLISHABLE_KEY, 'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 201
    except Exception as e:
        print('  插入失败:', e)
        return False


def main():
    # (截图路径, [(cx, cy, r, hero_id), ...])，hero_id 为 None 表示空 ban（跳过）
    datasets = [
        ('runtime-screenshot.png', [
            (43, 41, 25, 'xiangyu'), (61, 113, 21, 'yixing'), (85, 61, 22, 'cang'),
            (151, 29, 30, 'yuanliuzhizi_support'), (197, 31, 31, 'niumo'),
            (1375, 43, 26, 'lixin'), (1423, 37, 29, 'yunzhongjun'), (1435, 115, 23, 'cang'),
            (1471, 43, 26, 'zhugeliang'), (1481, 115, 17, 'caocao'),
        ]),
        ('测试用例/62f73ca5e389165a91ac3fff2dab97a1.jpg', [
            (141, 38, 24, 'dunshan'), (197, 37, 23, 'donghuangtaiyi'), (256, 38, 24, 'yunyao'),
            (313, 37, 23, 'zhangliang'), (370, 38, 27, None),
            (1551, 38, 21, 'kai'), (1607, 39, 22, 'dayu'), (1663, 38, 23, 'zhangliang'),
            (1719, 37, 23, 'guanyu'), (1777, 38, 24, 'sunquan'),
        ]),
    ]

    total = 0
    for path, circles in datasets:
        shot = imread_unicode(path)
        if shot is None:
            print('无法读取', path)
            continue
        print('==', path, '==')
        for (cx, cy, r, hid) in circles:
            if hid is None:
                continue
            b64 = crop_square(shot, cx, cy, r)
            if b64 and insert_sample(hid, b64):
                total += 1
                print('  已写入', hid)
    print('\n共写入', total, '条训练样本')


if __name__ == '__main__':
    main()
