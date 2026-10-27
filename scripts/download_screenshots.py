# -*- coding: utf-8 -*-
# 下载积累的识别截图（recognition_events.image_b64），分析分辨率/头像位置分布
import json
import base64
import os
import urllib.request
import cv2
import numpy as np

SUPABASE_URL = 'https://nvgvaphzhqgsbxqrfoyb.supabase.co'
PUBLISHABLE_KEY = 'sb_publishable_DJHwKetxg1LHNFdwlhF6jA_eQ88lwaZ'
OUT = '_screenshots'

def fetch(url):
    req = urllib.request.Request(url, headers={'apikey': PUBLISHABLE_KEY})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8'))

def main():
    events = fetch(SUPABASE_URL + '/rest/v1/recognition_events?select=id,image_b64&limit=5000')
    with_img = [e for e in events if e.get('image_b64')]
    print('识别事件总数:', len(events), '| 含截图:', len(with_img))

    os.makedirs(OUT, exist_ok=True)
    sizes = []
    for i, e in enumerate(with_img):
        b64 = e['image_b64']
        if not b64:
            continue
        buf = base64.b64decode(b64)
        img = cv2.imdecode(np.frombuffer(buf, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            print(f'  #{i} 解码失败')
            continue
        h, w = img.shape[:2]
        sizes.append((w, h))
        cv2.imwrite(os.path.join(OUT, e['id'] + '.jpg'), img)
    print('已保存', len(sizes), '张截图到', OUT)

    # 分辨率分布
    from collections import Counter
    dist = Counter(sizes)
    print('\n分辨率分布:')
    for (w, h), n in dist.most_common():
        print(f'  {w}x{h}  {n} 张  宽高比 {w/h:.2f}')

if __name__ == '__main__':
    main()
