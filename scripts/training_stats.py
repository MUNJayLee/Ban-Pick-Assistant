# -*- coding: utf-8 -*-
# 训练样本统计：查看已采集的「修正标注」数据量（深度学习/主动学习的数据基础）
# 用法: python scripts/training_stats.py
import json
import base64
import urllib.request

SUPABASE_URL = 'https://nvgvaphzhqgsbxqrfoyb.supabase.co'
PUBLISHABLE_KEY = 'sb_publishable_DJHwKetxg1LHNFdwlhF6jA_eQ88lwaZ'


def main():
    url = SUPABASE_URL + '/rest/v1/training_samples?select=hero_id,image_b64,created_at&limit=5000'
    req = urllib.request.Request(url, headers={'apikey': PUBLISHABLE_KEY})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            samples = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print('拉取样本失败：', e)
        return

    print('训练样本总数：', len(samples))

    # 按英雄统计
    name_map = {}
    try:
        heroes = json.load(open('src/data/heroes.json', encoding='utf-8'))['heroes']
        for h in heroes:
            name_map[h['id']] = h['name']
    except Exception:
        pass

    by_hero = {}
    for s in samples:
        by_hero[s['hero_id']] = by_hero.get(s['hero_id'], 0) + 1
    print('\n按英雄分布（按数量降序）：')
    for hid, cnt in sorted(by_hero.items(), key=lambda x: -x[1]):
        print('  %-12s %-10s %d' % (hid, name_map.get(hid, hid), cnt))

    # 总大小估算
    total_bytes = sum(len(s.get('image_b64', '')) for s in samples)
    print('\n样本图片 base64 总大小：%.1f KB' % (total_bytes / 1024))

    print('\n说明：')
    print('  - 这些样本是你在截图导入时「手动修正」后自动采集的（头像裁剪 + 正确英雄标注）。')
    print('  - 识别器已将它们回灌到参考集，下一次识别同类英雄会更准。')
    print('  - 样本积累到一定量后，可用 scripts/train_classifier.py 训练深度学习分类器。')


if __name__ == '__main__':
    main()
