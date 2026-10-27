# -*- coding: utf-8 -*-
"""
王者BP助手 · 训练样本批量采集工具
================================
加速积累游戏内头像样本，最终支撑 MobileNetV2 分类器训练。

命令：
  stats                         统计云端训练样本分布
  from-events [--apply]         从 recognition_events（有截图且人工修正过的记录）
                                重新切出头像生成样本（batch_id 关联，自动去重）
  label <截图> <蓝5> <红5> [--apply]   手动标注一张本地截图
  dryrun                        等价于不带 --apply 的预览

用法示例：
  # 预览从云端事件能采到多少样本
  python scripts/collect_samples.py from-events

  # 实际写入（切头像 + 上传 Supabase）
  python scripts/collect_samples.py from-events --apply

  # 手动标注一张截图（中文名或 hero_id，空 ban 用 - 或空）
  python scripts/collect_samples.py label "测试用例/xx.jpg" "马超,海月,西施,朵莉亚,盾山" "盾山,张飞,墨子,元流之子(射手),庄周" --apply

样本裁剪与前端 cropAvatar 一致：sz=2.2r 方形 → resize 96 → JPEG。
"""
import sys
import os
import json
import base64
import urllib.request

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recognize_screenshot as R

SUPABASE_URL = 'https://nvgvaphzhqgsbxqrfoyb.supabase.co'
PUBLISHABLE_KEY = 'sb_publishable_DJHwKetxg1LHNFdwlhF6jA_eQ88lwaZ'

SAMPLE_SIZE = 96


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------
def _get(url):
    req = urllib.request.Request(url, headers={'apikey': PUBLISHABLE_KEY})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))


def _post(table, payload):
    req = urllib.request.Request(
        SUPABASE_URL + '/rest/v1/' + table,
        data=json.dumps(payload).encode('utf-8'),
        headers={'apikey': PUBLISHABLE_KEY, 'Content-Type': 'application/json',
                 'Prefer': 'return=minimal'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def load_name_map():
    manifest = json.load(open('avatars/manifest.json', encoding='utf-8'))
    id2name = {m['id']: m['name'] for m in manifest}
    name2id = {m['name']: m['id'] for m in manifest}
    # 也支持英文 id 直接输入
    for m in manifest:
        name2id[m['id']] = m['id']
    return id2name, name2id


def crop_avatar(shot, cx, cy, r, size=SAMPLE_SIZE):
    """与前端 cropAvatar 一致：sz=2.2r 方形裁剪 → resize size。"""
    H, W = shot.shape[:2]
    sz = int(r * 2.2)
    x = max(0, min(W - sz, cx - sz // 2))
    y = max(0, min(H - sz, cy - sz // 2))
    crop = shot[y:y + sz, x:x + sz]
    img = cv2.resize(crop, (size, size))
    _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buf).decode('ascii')


def parse_names(s, name2id):
    """把逗号分隔的中文名/hero_id 列表转成 hero_id 列表（空位用 None）。"""
    parts = [p.strip() for p in s.split(',')]
    out = []
    for p in parts:
        if not p or p in ('-', '—', '空', 'none', 'None'):
            out.append(None)
        elif p in name2id:
            out.append(name2id[p])
        else:
            print('[warn] 未识别的英雄名：%r，跳过' % p)
            out.append(None)
    return out


# ---------------------------------------------------------------------------
# 命令实现
# ---------------------------------------------------------------------------
def cmd_stats():
    samples = _get(SUPABASE_URL + '/rest/v1/training_samples?select=hero_id&limit=50000')
    from collections import Counter
    cnt = Counter(s['hero_id'] for s in samples)
    id2name, _ = load_name_map()
    print('训练样本总数:', len(samples))
    print('覆盖英雄数: %d / %d' % (len(cnt), len(id2name)))
    print('样本最多的 20 个英雄:')
    for hid, c in cnt.most_common(20):
        print('  %-24s %d' % (id2name.get(hid, hid), c))
    print('样本数为 0 的英雄数:', sum(1 for h in id2name if h not in cnt))


def _collect_from_shot(shot, blue_ids, red_ids, batch_id, apply, id2name):
    """对一张截图按左右各 5 个 ban 位切头像，返回待上传样本列表 [(hero_id, b64)]。"""
    left, right = R.detect_circles(shot)
    left = R.validate_row(left)
    right = R.validate_row(right)
    out = []
    for side, circles, bans in [('蓝', left, blue_ids), ('红', right, red_ids)]:
        for i, (cx, cy, r) in enumerate(circles):
            if i >= len(bans):
                break
            hid = bans[i]
            if not hid:
                continue  # 空 ban 不采
            b64 = crop_avatar(shot, cx, cy, r)
            out.append((hid, b64))
            print('  %s%d %-20s ✓' % (side, i + 1, id2name.get(hid, hid)))
    return out


def cmd_from_events(apply):
    events = _get(SUPABASE_URL + '/rest/v1/recognition_events'
                  '?select=id,blue_bans,red_bans,corrections,image_b64&order=created_at.desc&limit=5000')
    id2name, _ = load_name_map()
    usable = [e for e in events if e.get('image_b64') and (e.get('corrections') or 0) > 0]
    print('可用的识别记录（有截图且修正过）:', len(usable))
    total = 0
    for e in usable:
        # 去重：该 batch 已采过多少样本
        existing = _get(SUPABASE_URL + '/rest/v1/training_samples?select=id&batch_id=eq.%s&limit=5000' % e['id'])
        if existing:
            print('事件 %s 已有 %d 条样本，跳过' % (e['id'][:8], len(existing)))
            continue
        shot = cv2.imdecode(np.frombuffer(base64.b64decode(e['image_b64']), np.uint8), cv2.IMREAD_COLOR)
        if shot is None:
            print('事件 %s 截图解码失败，跳过' % e['id'][:8])
            continue
        print('\n事件 %s: 蓝=%s 红=%s' % (e['id'][:8], e.get('blue_bans'), e.get('red_bans')))
        items = _collect_from_shot(shot, e.get('blue_bans') or [], e.get('red_bans') or [], e['id'], apply, id2name)
        if apply and items:
            for hid, b64 in items:
                _post('training_samples', {
                    'hero_id': hid, 'image_b64': b64, 'source': 'manual', 'batch_id': e['id'],
                })
            print('  已写入 %d 条样本' % len(items))
        total += len(items)
    print('\n合计可采集样本: %d 条%s' % (total, '' if apply else '（预览，加 --apply 写入）'))


def cmd_label(path, blue_str, red_str, apply):
    _, name2id = load_name_map()
    id2name, _ = load_name_map()
    shot = R.imread_unicode(path)
    if shot is None:
        print('无法读取截图:', path)
        return
    blue_ids = parse_names(blue_str, name2id)
    red_ids = parse_names(red_str, name2id)
    print('蓝方:', [(id2name.get(h) if h else '空') for h in blue_ids])
    print('红方:', [(id2name.get(h) if h else '空') for h in red_ids])
    batch_id = 'manual-' + os.path.basename(path)
    # 去重：该 batch 已存在的 hero_id 跳过（支持超时后重跑补缺）
    existing = _get(SUPABASE_URL + '/rest/v1/training_samples?select=hero_id&batch_id=eq.%s&limit=5000' % batch_id)
    skip = set(s['hero_id'] for s in existing)
    if skip:
        print('该 batch 已有 %d 条样本，将跳过重复英雄' % len(skip))
    items = _collect_from_shot(shot, blue_ids, red_ids, batch_id, apply, id2name)
    new_items = [(h, b) for h, b in items if h not in skip]
    if apply and new_items:
        for hid, b64 in new_items:
            _post('training_samples', {
                'hero_id': hid, 'image_b64': b64, 'source': 'manual', 'batch_id': batch_id,
            })
        print('已写入 %d 条样本（跳过 %d 条重复）' % (len(new_items), len(items) - len(new_items)))
    else:
        print('共 %d 条样本，其中新增 %d 条%s' % (len(items), len(new_items), '' if apply else '（预览，加 --apply 写入）'))


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    cmd = args[0]
    apply = '--apply' in args
    if cmd == 'stats':
        cmd_stats()
    elif cmd == 'from-events':
        cmd_from_events(apply)
    elif cmd == 'label':
        rest = [a for a in args[1:] if a != '--apply']
        if len(rest) < 3:
            print('用法: python scripts/collect_samples.py label <截图> <蓝5> <红5> [--apply]')
            return
        cmd_label(rest[0], rest[1], rest[2], apply)
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
