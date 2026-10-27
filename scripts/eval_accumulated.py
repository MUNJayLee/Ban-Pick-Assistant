# -*- coding: utf-8 -*-
# 用积累的识别事件（blue_bans/red_bans 为标准答案）评估识别准确率
import json
import base64
import os
import subprocess
import urllib.request

SUPABASE_URL = 'https://nvgvaphzhqgsbxqrfoyb.supabase.co'
PUBLISHABLE_KEY = 'sb_publishable_DJHwKetxg1LHNFdwlhF6jA_eQ88lwaZ'

def fetch(url):
    req = urllib.request.Request(url, headers={'apikey': PUBLISHABLE_KEY})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8'))

def main():
    events = fetch(SUPABASE_URL + '/rest/v1/recognition_events?select=id,blue_bans,red_bans,image_b64&limit=5000')
    with_img = [e for e in events if e.get('image_b64') and (e.get('blue_bans') or e.get('red_bans'))]
    print('可评估事件:', len(with_img))

    total_correct = 0
    total = 0
    for i, e in enumerate(with_img):
        path = os.path.join('_screenshots', e['id'] + '.jpg')
        if not os.path.exists(path):
            continue
        out = subprocess.run(['python', 'scripts/recognize_screenshot.py', path],
                             capture_output=True, text=True, encoding='utf-8')
        try:
            res = json.loads(out.stdout.strip().splitlines()[-1])
        except Exception:
            print(f'#{i} 解析失败')
            continue
        if res.get('error'):
            print(f'#{i} 识别错误: {res["error"]}')
            continue
        gt_blue = set(e['blue_bans'] or [])
        gt_red = set(e['red_bans'] or [])
        rec_blue = set(r['hero_id'] for r in res['results'] if r['label'].startswith('我方') and r['hero_id'])
        rec_red = set(r['hero_id'] for r in res['results'] if r['label'].startswith('敌方') and r['hero_id'])
        # 用集合匹配（顺序无关），只比较数量较少的一侧作为容差
        blue_ok = len(rec_blue & gt_blue)
        red_ok = len(rec_red & gt_red)
        gt_n = len(gt_blue) + len(gt_red)
        correct = blue_ok + red_ok
        total_correct += correct
        total += gt_n
        print(f'#{i} 蓝:{blue_ok}/{len(gt_blue)} 红:{red_ok}/{len(gt_red)}  (识别蓝={sorted(rec_blue)} 真蓝={sorted(gt_blue)} 识别红={sorted(rec_red)} 真红={sorted(gt_red)})')

    print(f'\n总体命中: {total_correct}/{total} = {total_correct/total*100:.1f}%' if total else '\n无数据')

if __name__ == '__main__':
    main()
