# -*- coding: utf-8 -*-
"""
采集高级英雄数据（laneMatchups / counterDetails）
=========================================
数据源: 天元之弈 /api/hero/analysis?heroId=<数字id>

采集内容:
  - laneMatchups: 对线各英雄的胜率/优势指数（86~97 个对手）
  - counterDetails: 克制关系 + advantageIndex（替代纯名字列表）
  - counteredByDetails: 被克制关系 + advantageIndex

用法:
  python scripts/scrape_advanced.py            # 采集全部
  python scripts/scrape_advanced.py --limit 3  # 只采 3 个（测试）
  python scripts/scrape_advanced.py --dry-run  # 只打印不写文件
"""
import argparse
import json
import os
import sys
import time

import requests

BASE = 'https://tianyuanzhiyi.com'
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
HEROES_PATH = 'src/data/heroes.json'
PUBLIC_PATH = 'public/data/heroes.json'


def fetch_hero_id_map():
    """从 /api/allheroes 拿 中文名 → 数字 id 映射。"""
    r = requests.get(BASE + '/api/allheroes', timeout=30, headers=HEADERS)
    r.raise_for_status()
    items = r.json()
    return {it['name']: it['id'] for it in items}, items


def fetch_analysis(hero_num):
    """拉取单个英雄的详细分析。"""
    r = requests.get(BASE + '/api/hero/analysis',
                     params={'heroId': hero_num},
                     timeout=20, headers=HEADERS)
    r.raise_for_status()
    return r.json()


def slim_matchups(raw):
    """精简 laneMatchups：只保留打分需要的字段。"""
    out = []
    for x in (raw or []):
        try:
            out.append({
                'heroName': x.get('heroName'),
                'winRate': round(float(x.get('winRate', 0)), 4),
                'advantageIndex': round(float(x.get('advantageIndex', 0)), 2),
                'totalMatches': int(x.get('totalMatches', 0)),
            })
        except Exception:
            continue
    return out


def slim_details(raw):
    """精简 counters/counteredBy 详情（带 advantageIndex）。"""
    out = []
    for x in (raw or []):
        try:
            out.append({
                'heroName': x.get('heroName'),
                'advantageIndex': round(float(x.get('advantageIndex', 0)), 2),
                'totalMatches': int(x.get('totalMatches', 0)),
            })
        except Exception:
            continue
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='只处理前 N 个英雄')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--sleep', type=float, default=0.35, help='每次请求间隔秒')
    args = ap.parse_args()

    if not os.path.exists(HEROES_PATH):
        print('找不到', HEROES_PATH)
        return 1

    data = json.load(open(HEROES_PATH, encoding='utf-8'))
    heroes = data.get('heroes', [])
    print('heroes.json: %d 个英雄' % len(heroes))

    try:
        name_to_num, all_items = fetch_hero_id_map()
        print('allheroes: %d 个，含数字 id 映射' % len(name_to_num))
    except Exception as e:
        print('获取英雄 id 映射失败:', e)
        return 2

    targets = heroes[:args.limit] if args.limit > 0 else heroes
    ok = fail = skip = 0
    for i, hero in enumerate(targets, 1):
        name = hero.get('name')
        num = name_to_num.get(name)
        if not num:
            skip += 1
            print('[%3d/%d] %-10s 无数字 id，跳过' % (i, len(targets), name))
            continue
        try:
            d = fetch_analysis(num)
            hero['laneMatchups'] = slim_matchups(d.get('laneMatchups'))
            hero['counterDetails'] = slim_details(d.get('counters'))
            hero['counteredByDetails'] = slim_details(d.get('counteredBy'))
            ok += 1
            print('[%3d/%d] %-10s 对线 %2d 个 | 克制 %2d | 被克 %2d' % (
                i, len(targets), name,
                len(hero['laneMatchups']), len(hero['counterDetails']),
                len(hero['counteredByDetails'])))
        except Exception as e:
            fail += 1
            print('[%3d/%d] %-10s 失败: %s' % (i, len(targets), name, e))
        time.sleep(args.sleep)

    print()
    print('完成: 成功 %d / 失败 %d / 跳过 %d' % (ok, fail, skip))

    if args.dry_run:
        print('（dry-run，不写文件）')
        return 0

    # 写回（保留原有缩进风格）
    json.dump(data, open(HEROES_PATH, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print('已写入', HEROES_PATH)

    # 同步到 public（前端实际加载的路径）
    try:
        os.makedirs(os.path.dirname(PUBLIC_PATH), exist_ok=True)
        with open(PUBLIC_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
        print('已同步', PUBLIC_PATH)
    except Exception as e:
        print('同步 public 失败:', e)

    return 0


if __name__ == '__main__':
    sys.exit(main())
