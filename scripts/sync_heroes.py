# -*- coding: utf-8 -*-
"""
新英雄同步工具
=========================================
对比「天元之弈 API」和本地英雄库，自动补齐缺失英雄：
  1. 下载官方头像（腾讯 CDN）→ avatars/{id}.jpg
  2. 补 avatars/manifest.json
  3. 补 src/data/heroes.json（tier / 克制关系等）

用法：
  python scripts/sync_heroes.py              # 检查并同步缺失英雄
  python scripts/sync_heroes.py --dry-run    # 只检查不写入
  python scripts/sync_heroes.py --name 王维   # 只处理指定英雄

说明：数据源头像 URL 现在加到反爬防护，改用腾讯官方 CDN
     （https://game.gtimg.cn/images/yxzj/img201606/heroimg/{num}/{num}.jpg）。
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from datetime import date

import numpy as np
import cv2

API_ALL = 'https://tianyuanzhiyi.com/api/allheroes'
API_TIER = 'https://tianyuanzhiyi.com/api/global/tier?date={date}'
API_ANALYSIS = 'https://tianyuanzhiyi.com/api/hero/analysis?heroId={num}'
CDN = 'https://game.gtimg.cn/images/yxzj/img201606/heroimg/{num}/{num}.jpg'

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')

# 职业中文 → roles / positions 映射
ROLE_MAP = {'中路': 'MAGE', '对抗路': 'WARRIOR', '游走': 'SUPPORT',
            '打野': 'ASSASSIN', '发育路': 'MARKSMAN'}
POS_MAP = {'中路': 'MID_LANE', '对抗路': 'CLASH_LANE', '游走': 'ROAM',
           '打野': 'JUNGLE', '发育路': 'FARM_LANE'}
PROFESSION_MAP = {'中路': '法核', '对抗路': '战边', '游走': '开团辅',
                  '打野': '野核', '发育路': '射核'}


def api_get(url, referer):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA, 'Accept': 'application/json', 'Referer': referer})
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode('utf-8'))


def pinyin_of(name):
    """用项目自带的 pinyin-pro 生成 id（Node 已在依赖里）。"""
    try:
        r = subprocess.run(
            ['node', '-e',
             "const {pinyin}=require('pinyin-pro');"
             "process.stdout.write(pinyin(process.argv[1],{toneType:'none'})"
             ".replace(/\\s+/g,'').replace(/[()（）]/g,'_').toLowerCase())",
             name],
            capture_output=True, encoding='utf-8', errors='replace', timeout=20,
            cwd=os.getcwd())
        out = (r.stdout or '').strip()
        if out and r.returncode == 0:
            return out
    except Exception:
        pass
    return None


def download_avatar(num, out_path):
    """从腾讯官方 CDN 下载头像，统一成 90x90 jpg。"""
    url = CDN.format(num=num)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    data = urllib.request.urlopen(req, timeout=30).read()
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError('头像解码失败（%d bytes）' % len(data))
    img = cv2.resize(img, (90, 90), interpolation=cv2.INTER_AREA)
    cv2.imwrite(out_path, img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='只检查不写入')
    ap.add_argument('--name', default=None, help='只处理指定英雄名')
    args = ap.parse_args()

    # ---- 读本地 ----
    manifest_path = 'avatars/manifest.json'
    heroes_path = 'src/data/heroes.json'
    manifest = json.load(open(manifest_path, encoding='utf-8'))
    heroes_doc = json.load(open(heroes_path, encoding='utf-8'))
    heroes = heroes_doc['heroes']
    local_names = {m['name'] for m in manifest}
    name2id = {m['name']: m['id'] for m in manifest}
    print('本地英雄库: manifest %d, heroes.json %d' % (len(manifest), len(heroes)))

    # ---- 拉数据源 ----
    print('拉取数据源...')
    all_heroes = api_get(API_ALL, 'https://tianyuanzhiyi.com/heroes')
    print('  allheroes: %d 个' % len(all_heroes))
    tier_doc = api_get(API_TIER.format(date=date.today().isoformat()),
                       'https://tianyuanzhiyi.com/tier')
    tier_by_name = {t['heroName']: t for t in tier_doc.get('tiers', [])}
    print('  tier: %d 个' % len(tier_by_name))

    # ---- 找缺失 ----
    missing = [h for h in all_heroes if h['name'] not in local_names]
    if args.name:
        missing = [h for h in missing if h['name'] == args.name]
        # 也支持补全性更新：指定英雄已存在则跳过
        if not missing and args.name in local_names:
            print('「%s」已存在，无需同步' % args.name)
            return 0

    if not missing:
        print('✓ 英雄库已是最新，无需同步')
        return 0

    print('\n发现 %d 个缺失英雄:' % len(missing))
    for h in missing:
        print('  %s (num=%s, role=%s)' % (h['name'], h['id'], h.get('roles')))

    if args.dry_run:
        print('\n[dry-run] 不写入')
        return 0

    # ---- 备份 ----
    for p in [manifest_path, heroes_path]:
        shutil.copy2(p, p + '.bak')
    print('\n已备份: manifest.json.bak / heroes.json.bak')

    added = []
    for h in missing:
        num, name = h['id'], h['name']
        hid = pinyin_of(name)
        if not hid:
            print('  [跳过] %s 无法生成拼音 id，请手动指定' % name)
            continue
        if hid in {m['id'] for m in manifest}:
            print('  [跳过] %s 的 id %s 已存在' % (name, hid))
            continue

        # 1) 下载头像（同时同步到 public/avatars，前端从那里加载）
        avatar_path = 'avatars/%s.jpg' % hid
        try:
            download_avatar(num, avatar_path)
            os.makedirs('public/avatars', exist_ok=True)
            shutil.copy2(avatar_path, 'public/avatars/%s.jpg' % hid)
            print('  [头像] %s → %s（已同步 public/avatars）' % (name, avatar_path))
        except Exception as e:
            print('  [失败] %s 头像下载失败: %s' % (name, e))
            continue

        # 2) manifest
        manifest.append({'id': hid, 'name': name, 'num': num})
        name2id[name] = hid

        # 3) tier + analysis
        tier = tier_by_name.get(name, {})
        try:
            ana = api_get(API_ANALYSIS.format(num=num),
                          'https://tianyuanzhiyi.com/hero/%s' % num)
        except Exception:
            ana = {}

        def to_ids(items, top_n=4):
            out = []
            for it in (items or [])[:top_n]:
                tgt = name2id.get(it.get('heroName'))
                if tgt:
                    out.append(tgt)
            return out

        role_cn = (tier.get('role') or h.get('roles') or '中路').split('/')[0]

        entry = {
            'id': hid,
            'name': name,
            'title': '',                       # 称号待补充
            'roles': [ROLE_MAP.get(role_cn, 'MAGE')],
            'aiWinRate': 0.5,
            'popularity': 5.0,
            'difficulty': 3,
            'counters': to_ids(ana.get('counters')),
            'counteredBy': to_ids(ana.get('counteredBy')),
            'synergies': to_ids(ana.get('goodSynergies')),
            'pickRate': 0.0,
            'banRate': 0.0,
            'tierScore': tier.get('finalNormalizedTierScore', 0),
            'tier': tier.get('tierInRole', 'T3'),
            'roleLabel': role_cn,
            'heroPower': tier.get('trueHeroPowerInRole', 0),
            'highBan': bool(tier.get('highBan', False)),
            'tierRank': tier.get('rankInRole', 999),
            'avatar': CDN.format(num=num),
            'positions': [POS_MAP.get(role_cn, 'MID_LANE')],
            'positionLabel': role_cn,
            'profession': PROFESSION_MAP.get(role_cn, '法核'),
            'antiSynergies': to_ids(ana.get('badSynergies')),
        }
        heroes.append(entry)
        added.append((name, hid, tier.get('tierInRole'), tier.get('rankInRole')))

    if not added:
        print('\n没有新增英雄')
        return 1

    # ---- 写回 ----
    manifest.sort(key=lambda x: x.get('num', 0))
    json.dump(manifest, open(manifest_path, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    heroes.sort(key=lambda x: x.get('tierRank', 999))
    json.dump(heroes_doc, open(heroes_path, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)

    # ---- 校验 ----
    m2 = json.load(open(manifest_path, encoding='utf-8'))
    h2 = json.load(open(heroes_path, encoding='utf-8'))['heroes']
    print('\n✓ 已同步 %d 个英雄:' % len(added))
    for name, hid, tier, rank in added:
        print('    %s (%s)  %s  排名%s' % (name, hid, tier, rank))
    print('现在: manifest %d, heroes.json %d' % (len(m2), len(h2)))

    # 头像文件校验
    bad = [m['id'] for m in m2 if not os.path.exists('avatars/%s.jpg' % m['id'])]
    if bad:
        print('⚠ 缺头像文件: %s' % bad)
    else:
        print('✓ 所有头像文件齐全')
    return 0


if __name__ == '__main__':
    sys.exit(main())
