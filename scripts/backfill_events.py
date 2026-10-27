# -*- coding: utf-8 -*-
# 把历史 training_samples 按时间分组回填成 recognition_events。
# 注意：样本里没有蓝红方信息，回填时统一放蓝方列，仅作统计参考；之后新导入会是准确的。
import json
import urllib.request

SUPABASE_URL = 'https://nvgvaphzhqgsbxqrfoyb.supabase.co'
PUBLISHABLE_KEY = 'sb_publishable_DJHwKetxg1LHNFdwlhF6jA_eQ88lwaZ'


def fetch(url):
    req = urllib.request.Request(url, headers={'apikey': PUBLISHABLE_KEY})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))


def insert_event(blue_bans, created_at):
    req = urllib.request.Request(
        SUPABASE_URL + '/rest/v1/recognition_events',
        data=json.dumps({
            'device_id': 'backfill',
            'blue_bans': blue_bans,
            'red_bans': [],
            'manual_edits': 0,
            'app_version': 'backfill',
        }).encode('utf-8'),
        headers={'apikey': PUBLISHABLE_KEY, 'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.status == 201


def main():
    samples = fetch(SUPABASE_URL + '/rest/v1/training_samples?select=hero_id,created_at&limit=5000')
    if not samples:
        print('无样本可回填')
        return

    # 按 created_at 升序排序
    samples.sort(key=lambda s: s['created_at'])

    # 按时间分组：相邻样本间隔 > 60 秒视为新的识别批次
    groups = []
    for s in samples:
        ts = s['created_at']
        if groups and _ts_diff(groups[-1]['last'], ts) <= 60:
            groups[-1]['heroes'].append(s['hero_id'])
            groups[-1]['last'] = ts
        else:
            groups.append({'heroes': [s['hero_id']], 'last': ts})

    print('按时间分组得到', len(groups), '个识别批次')

    # 跳过已有事件数（避免重复回填）
    existing = fetch(SUPABASE_URL + '/rest/v1/recognition_events?select=id&limit=5000')
    if existing:
        print('已有识别事件', len(existing), '条，跳过（如需重填请先清空 recognition_events）')
        return

    n = 0
    for g in groups:
        # 去重并保持顺序
        heroes = list(dict.fromkeys(g['heroes']))
        if insert_event(heroes, g['last']):
            n += 1
            print('  批次 %d 个英雄 -> %s' % (len(heroes), '、'.join(heroes[:5]) + ('…' if len(heroes) > 5 else '')))
    print('\n共回填', n, '条识别记录')


def _ts_diff(a, b):
    from datetime import datetime
    ta = datetime.fromisoformat(a.replace('Z', '+00:00'))
    tb = datetime.fromisoformat(b.replace('Z', '+00:00'))
    return abs((tb - ta).total_seconds())


if __name__ == '__main__':
    main()
