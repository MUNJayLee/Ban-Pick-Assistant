# -*- coding: utf-8 -*-
"""测试小鱼 · 数据一致性验证（只读）

覆盖：
  1) src/data/heroes.json 英雄数 / 字段完整性 / 类型 / 枚举
  2) 引用完整性（counters/counteredBy/synergies/antiSynergies 用 id；laneMatchups 等用 heroName）
  3) src/data/heroes.json 与 public/data/heroes.json 是否一致
  4) 头像资源：avatars/manifest.json、avatars/*.jpg、public/avatars/*.jpg 与英雄表是否对齐

跑法：python scripts/_test_data.py
输出：_diag/test_data.json
"""
import hashlib
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

SRC = 'src/data/heroes.json'
PUB = 'public/data/heroes.json'
OUT_JSON = '_diag/test_data.json'

POSITIONS = {'CLASH_LANE', 'JUNGLE', 'MID_LANE', 'FARM_LANE', 'ROAM'}
ROLES = {'TANK', 'WARRIOR', 'ASSASSIN', 'MAGE', 'MARKSMAN', 'SUPPORT'}
TIERS = {'T0', 'T0.5', 'T1', 'T2', 'T3', 'T4'}
REQUIRED = ['id', 'name', 'positions', 'profession', 'tierScore', 'counters',
            'laneMatchups', 'counterDetails']

RECORDS = []


def rec(item, expected, actual, ok, note=''):
    RECORDS.append({'item': item, 'expected': expected, 'actual': actual,
                    'pass': bool(ok), 'note': note})
    print('[%s] %-42s expect=%-26s actual=%s %s' % (
        'PASS' if ok else 'FAIL', item, expected, actual, note or ''))


def sha256(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def main():
    print('=' * 78)
    print('  测试小鱼 · 数据一致性  %s' % time.strftime('%Y-%m-%d %H:%M:%S'))
    print('=' * 78)

    if not os.path.exists(SRC):
        print('FATAL: %s 不存在' % SRC)
        return 2
    data = json.load(open(SRC, encoding='utf-8'))
    heroes = data.get('heroes') or []
    ids = [h.get('id') for h in heroes]
    names = [h.get('name') for h in heroes]
    idset, nameset = set(ids), set(names)

    # 1) 数量 / 主键
    rec('heroes 总数', '133', str(len(heroes)), len(heroes) == 133)
    dup_ids = sorted({i for i in ids if ids.count(i) > 1})
    rec('id 唯一', '无重复', '重复: %s' % (dup_ids or '无'), not dup_ids)
    dup_names = sorted({n for n in names if names.count(n) > 1})
    rec('name 唯一', '无重复', '重复: %s' % (dup_names or '无'), not dup_names)
    bad_id_fmt = [i for i in ids if not i or not i.isascii() or i != i.lower() or ' ' in i]
    rec('id 格式（小写 ascii，用作文件名）', '全部合法',
        '异常: %s' % (bad_id_fmt[:5] or '无'), not bad_id_fmt)

    # 2) 必需字段
    missing = {}
    for h in heroes:
        lack = [f for f in REQUIRED if f not in h or h[f] is None]
        if lack:
            missing[h.get('id')] = lack
    rec('8 个必需字段齐全', '0 缺失', '%d 个英雄缺字段' % len(missing),
        not missing, json.dumps(missing, ensure_ascii=False)[:200])

    # 3) 字段类型 / 枚举
    bad_pos = [(h['id'], h.get('positions')) for h in heroes
               if not isinstance(h.get('positions'), list) or not h['positions']
               or not set(h['positions']) <= POSITIONS]
    rec('positions 合法枚举且非空', '[]', '%d 异常' % len(bad_pos),
        not bad_pos, str(bad_pos[:3]))

    bad_roles = [(h['id'], h.get('roles')) for h in heroes
                 if not isinstance(h.get('roles'), list) or not h['roles']
                 or not set(h['roles']) <= ROLES]
    rec('roles 合法枚举且非空', '[]', '%d 异常' % len(bad_roles),
        not bad_roles, str(bad_roles[:3]))

    bad_tier = [(h['id'], h.get('tier')) for h in heroes if h.get('tier') not in TIERS]
    rec('tier 合法枚举', '[]', '%d 异常' % len(bad_tier), not bad_tier, str(bad_tier[:3]))

    bad_score = [(h['id'], h.get('tierScore')) for h in heroes
                 if not isinstance(h.get('tierScore'), (int, float))
                 or not (0 <= h['tierScore'] <= 100)]
    rec('tierScore 数值 0~100', '[]', '%d 异常' % len(bad_score),
        not bad_score, str(bad_score[:3]))

    empty_prof = [h['id'] for h in heroes if not h.get('profession')]
    rec('profession 非空', '0 个空', '%d 个空: %s' % (len(empty_prof), empty_prof),
        not empty_prof, '空 profession 会退化为"未知"展示')

    # 4) 引用完整性
    dangling = []
    for h in heroes:
        for f in ('counters', 'counteredBy', 'synergies', 'antiSynergies'):
            for ref in h.get(f) or []:
                if ref not in idset:
                    dangling.append('%s.%s->%s' % (h['id'], f, ref))
    rec('id 型引用（counters 等）无悬挂', '0', '%d 悬挂' % len(dangling),
        not dangling, '; '.join(dangling[:5]))

    dn = []
    for h in heroes:
        for f in ('laneMatchups', 'counterDetails', 'counteredByDetails'):
            for row in h.get(f) or []:
                hn = row.get('heroName') if isinstance(row, dict) else None
                if not hn or hn not in nameset:
                    dn.append('%s.%s->%r' % (h['id'], f, hn))
    rec('name 型引用（laneMatchups 等）无悬挂', '0', '%d 悬挂' % len(dn),
        not dn, '; '.join(dn[:5]))

    selfref = []
    for h in heroes:
        for f in ('laneMatchups', 'counterDetails', 'counteredByDetails'):
            for row in h.get(f) or []:
                if isinstance(row, dict) and row.get('heroName') == h['name']:
                    selfref.append('%s.%s' % (h['id'], f))
        for f in ('counters', 'counteredBy'):
            if h.get('id') in (h.get(f) or []):
                selfref.append('%s.%s' % (h['id'], f))
    rec('无自引用（自己克自己）', '0', '%d 处' % len(selfref), not selfref,
        '; '.join(selfref[:5]))

    # 5) laneMatchups / counterDetails 结构
    bad_lm = []
    bad_cd = []
    for h in heroes:
        for row in h.get('laneMatchups') or []:
            if not all(k in row for k in ('heroName', 'winRate', 'advantageIndex', 'totalMatches')):
                bad_lm.append('%s:缺字段' % h['id'])
            elif not isinstance(row['winRate'], (int, float)) or not (0 <= row['winRate'] <= 1):
                bad_lm.append('%s:winRate=%r' % (h['id'], row['winRate']))
            elif not isinstance(row['totalMatches'], int) or row['totalMatches'] < 0:
                bad_lm.append('%s:totalMatches=%r' % (h['id'], row['totalMatches']))
        for row in h.get('counterDetails') or []:
            if not all(k in row for k in ('heroName', 'advantageIndex', 'totalMatches')):
                bad_cd.append('%s:缺字段' % h['id'])
    rec('laneMatchups 结构合法', '[]', '%d 异常' % len(bad_lm), not bad_lm,
        str(bad_lm[:3]))
    rec('counterDetails 结构合法', '[]', '%d 异常' % len(bad_cd), not bad_cd,
        str(bad_cd[:3]))

    empty_cnt = [h['id'] for h in heroes if not h.get('counters')]
    empty_cd = [h['id'] for h in heroes if not h.get('counterDetails')]
    empty_lm = [h['id'] for h in heroes if not h.get('laneMatchups')]
    rec('counters / counterDetails / laneMatchups 非空', '0 / 0 / 0',
        '%d / %d / %d %s' % (len(empty_cnt), len(empty_cd), len(empty_lm),
                             (empty_cnt + empty_cd)[:6]),
        not (empty_cnt or empty_cd or empty_lm),
        '空数据英雄在推荐/对线面板无内容')

    # 6) 数值字段
    bad_rate = []
    for h in heroes:
        for f in ('pickRate', 'banRate', 'aiWinRate'):
            v = h.get(f)
            if v is None or not isinstance(v, (int, float)) or not (0 <= v <= 1):
                bad_rate.append('%s.%s=%r' % (h['id'], f, v))
        v = h.get('heroPower')
        if v is None or not isinstance(v, (int, float)):
            bad_rate.append('%s.heroPower=%r' % (h['id'], v))
    rec('pickRate/banRate/aiWinRate ∈[0,1] 且 heroPower 数值', '[]',
        '%d 异常' % len(bad_rate), not bad_rate, str(bad_rate[:3]))

    # 7) src vs public
    if os.path.exists(PUB):
        h1, h2 = sha256(SRC), sha256(PUB)
        rec('src 与 public/heroes.json 一致', h1[:16], h2[:16], h1 == h2)
        pub = json.load(open(PUB, encoding='utf-8'))
        rec('public 英雄数', '133', str(len(pub.get('heroes') or [])),
            len(pub.get('heroes') or []) == 133)
    else:
        rec('public/data/heroes.json 存在', '存在', '缺失', False)

    # 8) 头像资源
    man_path = 'avatars/manifest.json'
    if os.path.exists(man_path):
        man = json.load(open(man_path, encoding='utf-8'))
        man_ids = [m.get('id') for m in man]
        rec('avatars/manifest.json 数量', '133', str(len(man)), len(man) == 133)
        rec('manifest 与 heroes 的 id 集合一致', '完全一致',
            'manifest-only=%s heroes-only=%s' % (sorted(set(man_ids) - idset),
                                                 sorted(idset - set(man_ids))),
            set(man_ids) == idset, '缺 id 会导致该英雄永远识别不到')
        miss_av = [i for i in man_ids if not os.path.exists('avatars/%s.jpg' % i)]
        rec('avatars/<id>.jpg 齐全', '0 缺失', '%d 缺失: %s' % (len(miss_av), miss_av[:5]),
            not miss_av)
        miss_pub = [i for i in ids if not os.path.exists('public/avatars/%s.jpg' % i)]
        rec('public/avatars/<id>.jpg 齐全', '0 缺失',
            '%d 缺失: %s' % (len(miss_pub), miss_pub[:5]), not miss_pub,
            '前端头像走 public/；缺失会 404')
    else:
        rec('avatars/manifest.json 存在', '存在', '缺失', False)

    import collections
    print('\n    tier 分布: %s' % dict(collections.Counter(h.get('tier') for h in heroes)))
    print('    positions 分布: %s' % dict(collections.Counter(
        p for h in heroes for p in (h.get('positions') or []))))
    print('    laneMatchups 总数: %d, counterDetails 总数: %d' % (
        sum(len(h.get('laneMatchups') or []) for h in heroes),
        sum(len(h.get('counterDetails') or []) for h in heroes)))

    total = len(RECORDS)
    passed = sum(1 for r in RECORDS if r['pass'])
    print('\n' + '=' * 78)
    print('  小计: %d 项 / 通过 %d / 失败 %d' % (total, passed, total - passed))
    for r in RECORDS:
        if not r['pass']:
            print('    [FAIL] %s: expect=%s actual=%s' % (
                r['item'], r['expected'], r['actual']))
    print('=' * 78)
    json.dump({'generated': time.strftime('%Y-%m-%d %H:%M:%S'), 'total': total,
               'passed': passed, 'failed': total - passed, 'records': RECORDS},
              open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('明细已写入 %s' % OUT_JSON)
    return 0


if __name__ == '__main__':
    sys.exit(main())
