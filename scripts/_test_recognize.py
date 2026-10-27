# -*- coding: utf-8 -*-
"""测试小鱼 · 识别函数批量验证（不改源码，只读样本 + import 现有函数）

覆盖：
  a) detect_phase     —— 视频帧 31 张（每 10 帧取样）+ 真机截图 25 张 + 结算帧 2 张
  b) recognize_bans   —— 真机截图（金标准：蓝 5 / 红 4，红5空）
  c) recognize_picks  —— 真机截图（10 个 pick 位 + 候选蒙太奇供人工核对）
  d) detect_player_floor —— 金标准截图 + 若干 final 帧
  e) detect_game_result  —— r_028 / r_029 + 反例

跑法：
  python scripts/_test_recognize.py            # 全量
  python scripts/_test_recognize.py --phase    # 只跑阶段
  python scripts/_test_recognize.py --bans     # 只跑 ban
输出：_diag/test_recognize.json / _diag/test_assets/*.png
"""
import argparse
import json
import os
import sys
import time
import traceback

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

import live_recognize as L  # noqa: E402

GOLD = '.uploads/shot_1787544554495.jpg'   # 真机截图金标准（1920x864）
OUT_DIR = '_diag/test_assets'
OUT_JSON = '_diag/test_recognize.json'

# ---------------------------------------------------------------------------
# 金标准（由测试小鱼人工看图标注，不依赖被测 OCR）
# ---------------------------------------------------------------------------
# 视频帧：每 10 帧取样一张，按顶部横幅文字标注
# 值 = (主预期, 可接受集合)：个别界面存在产品语义歧义时给出可接受范围
PHASE_EXPECT_FRAMES = {
    'f_001': ('other', {'other'}),   # 匹配成功/个人主页
    'f_011': ('other', {'other'}),
    'f_021': ('other', {'other'}),
    'f_031': ('other', {'other'}),
    'f_041': ('other', {'other'}),   # 本局您将分路 发育路
    'f_051': ('other', {'other'}),   # 请预选您想玩的英雄（BP 之前）
    'f_061': ('ban', {'ban'}),       # 禁英雄
    'f_071': ('ban', {'ban'}),
    'f_081': ('ban', {'ban'}),
    'f_091': ('ban', {'ban'}),
    'f_101': ('ban', {'ban'}),
    'f_111': ('pick', {'pick'}),     # 等待其他玩家选择
    'f_121': ('pick', {'pick'}),
    'f_131': ('pick', {'pick'}),
    'f_141': ('pick', {'pick'}),
    'f_151': ('ban', {'ban'}),       # 禁英雄（第二段 BP）
    'f_161': ('ban', {'ban'}),
    'f_171': ('ban', {'ban'}),
    'f_181': ('ban', {'ban'}),
    'f_191': ('pick', {'pick'}),     # 等待其他玩家选择
    'f_201': ('final', {'final'}),   # 最后调整 19
    'f_211': ('final', {'final'}),   # 最后调整 9
    'f_221': ('final', {'final', 'pick'}),   # 准备前往发育路 0（BP 已结束，阵容可见）
    'f_231': ('other', {'other'}),   # 英雄加载
    'f_241': ('other', {'other'}),   # 游戏内
    'f_251': ('other', {'other'}),
    'f_261': ('other', {'other'}),
    'f_271': ('other', {'other'}),
    'f_281': ('other', {'other'}),
    'f_291': ('other', {'other'}),
    'f_301': ('other', {'other'}),
}

# 真机截图（按 sha256 去重后 25 张可读图）
PHASE_EXPECT_UPLOADS = {
    'shot_1787542326549.jpg': ('pick', {'pick'}),    # 等待其他玩家选择（= 金标准图）
    'shot_1787553851489.jpg': ('other', {'other'}),  # 不是游戏画面（Web 前端）
    'shot_1787553938944.jpg': ('final', {'final'}),  # 最后调整 17
    'shot_1787569134699.jpg': ('pick', {'pick'}),    # 等待其他玩家选择（1280x576）
    'shot_1787569227189.jpg': ('pick', {'pick'}),    # 请选择您的发育路英雄 11
    'shot_1787569292074.jpg': ('final', {'final'}),  # 最后调整 14
    'shot_1787569517912.jpg': ('pick', {'pick'}),    # 等待其他玩家选择
    'shot_1787578476326.jpg': ('final', {'final'}),  # 最后调整 14（2772x1280）
    'shot_1787580634934.jpg': ('pick', {'pick'}),    # 等待其他玩家选择
    'shot_1787580702874.jpg': ('final', {'final'}),  # 最后调整 15
    'shot_1787580760612.jpg': ('final', {'final'}),  # 最后调整 12
    'shot_1787580823151.jpg': ('pick', {'pick'}),    # 等待其他玩家选择
    'shot_1787580887777.jpg': ('final', {'final'}),  # 最后调整 7
    'shot_1787581346090.jpg': ('final', {'final', 'pick'}),  # 准备前往发育路 2
    'shot_1787581474389.jpg': ('pick', {'pick'}),    # 等待其他玩家选择
    'shot_1787582573545.jpg': ('final', {'final', 'pick'}),  # 准备前往发育路 4
    'shot_1787651841122.jpg': ('final', {'final'}),  # 最后调整 17（2400x1080）
    'shot_1787651905297.jpg': ('final', {'final', 'pick'}),  # 准备前往发育路 5
    'shot_1787651956148.jpg': ('final', {'final'}),  # 最后调整 17
    'shot_1787671116722.jpg': ('final', {'final'}),  # 最后调整 18（2772x1280）
    'shot_1787671209086.jpg': ('final', {'final'}),  # 最后调整 18
    'shot_1787672289941.jpg': ('final', {'final'}),  # 最后调整 6
    'shot_1787925958737.jpg': ('ban', {'ban'}),      # 禁用结束（ban 结果面板，ban 位完整可见）
    'shot_1787927467197.jpg': ('ban', {'ban'}),      # 禁用结束
    'shot_1787928343974.jpg': ('pick', {'pick'}),    # 等待其他玩家选择 19
}

# 金标准 ban（用户给定）
GOLD_BANS_BLUE = ['廉颇', '上官婉儿', '敖隐', '姬小满', '百里玄策']
GOLD_BANS_RED = ['弈星', '蚩奼', '大禹', '元歌', '']   # 第 5 位空 ban

# 结算帧
RESULT_EXPECT = {
    'r_028': {'is_result': True, 'result': 'WIN', 'delta': 13, 'is_mvp': False},
    'r_029': {'is_result': True, 'result': 'WIN', 'delta': 13, 'is_mvp': True},
}

RECORDS = []   # 汇总


def load(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def reset_phase_cache():
    L._PHASE_CACHE['sig'] = None
    L._PHASE_CACHE['phase'] = 'other'
    L._PHASE_CACHE['score'] = 0.0


def reset_picks_cache():
    L._PICKS_CACHE['sig'] = None
    L._PICKS_CACHE['picks'] = None


def rec(case, item, expected, actual, ok, note='', ms=None):
    r = {'case': case, 'item': item, 'expected': expected, 'actual': actual,
         'pass': bool(ok), 'note': note, 'ms': ms}
    RECORDS.append(r)
    flag = 'PASS' if ok else 'FAIL'
    print('[%s] %-8s %-28s expect=%-8s actual=%s %s' % (
        flag, case, item, expected, actual, note))
    return r


# ---------------------------------------------------------------------------
# a) detect_phase
# ---------------------------------------------------------------------------
def test_phase_frames():
    print('\n=== a1) detect_phase: 视频帧（1280x720，每 10 帧取样）===')
    for name, (exp, allow) in PHASE_EXPECT_FRAMES.items():
        p = '_video/full_frames/%s.jpg' % name
        img = load(p)
        if img is None:
            rec('a1', name, exp, 'UNREADABLE', False)
            continue
        reset_phase_cache()
        t0 = time.time()
        phase, score = L.detect_phase(img)
        dt = (time.time() - t0) * 1000
        rec('a1', name, exp, phase, phase in allow,
            'score=%.2f %dx%d' % (score, img.shape[1], img.shape[0]), round(dt, 1))


def test_phase_uploads():
    print('\n=== a2) detect_phase: 真机截图（去重后，多分辨率）===')
    for name, (exp, allow) in PHASE_EXPECT_UPLOADS.items():
        p = '.uploads/%s' % name
        img = load(p)
        if img is None:
            rec('a2', name, exp, 'UNREADABLE', False)
            continue
        reset_phase_cache()
        t0 = time.time()
        phase, score = L.detect_phase(img)
        dt = (time.time() - t0) * 1000
        rec('a2', name, exp, phase, phase in allow,
            'score=%.2f %dx%d' % (score, img.shape[1], img.shape[0]), round(dt, 1))


def test_phase_result_frames():
    print('\n=== a3) detect_phase: 结算帧（应为 other）===')
    for name in ('r_028', 'r_029'):
        img = load('_video/result_frames/%s.jpg' % name)
        reset_phase_cache()
        phase, score = L.detect_phase(img)
        rec('a3', name, 'other', phase, phase == 'other', 'score=%.2f' % score)


def test_phase_cache(labeled):
    """帧差缓存风险。

    缓存逻辑：顶部 35% 缩到 160x45 后平均差 < 3.0 就复用上次 OCR 结果。
    这里验证 ①顺序喂帧结果是否仍正确 ②是否存在「跨阶段近似图 → 复用错阶段」。
    """
    print('\n=== a4) detect_phase: 帧差缓存行为 ===')
    reset_phase_cache()
    mismatch = []
    for name, exp in labeled:
        img = load(name_path(name))
        if img is None:
            continue
        phase, score = L.detect_phase(img)
        if phase != exp:
            mismatch.append('%s: exp=%s act=%s' % (os.path.basename(name), exp, phase))
    rec('a4', 'sequence(cache on)', '0 wrong', '%d wrong' % len(mismatch),
        len(mismatch) == 0, '; '.join(mismatch[:6]))

    # 找「顶部近似但阶段不同」的图对，验证是否会被缓存污染
    sigs = []
    for name, exp in labeled:
        img = load(name_path(name))
        if img is None:
            continue
        sigs.append((os.path.basename(name), exp, _sig(img)))
    pairs = []
    for i in range(len(sigs)):
        for j in range(i + 1, len(sigs)):
            if sigs[i][1] == sigs[j][1]:
                continue
            d = float(np.abs(sigs[i][2] - sigs[j][2]).mean())
            if d < 3.0:
                pairs.append((d, sigs[i][0], sigs[i][1], sigs[j][0], sigs[j][1]))
    pairs.sort()
    print('    顶部相似(<3.0)但阶段不同的图对: %d 组' % len(pairs))
    for p in pairs[:5]:
        print('      d=%.2f %s(%s) vs %s(%s)' % p)
    if pairs:
        d, n1, ph1, n2, ph2 = pairs[0]
        reset_phase_cache()
        p1, _ = L.detect_phase(load(name_path(n1)))
        p2, _ = L.detect_phase(load(name_path(n2)))   # 被缓存污染？
        ok = (p1 == ph1 and p2 == ph2)
        rec('a4', 'cache-collision', '%s=>%s, %s=>%s' % (n1, ph1, n2, ph2),
            '%s=>%s, %s=>%s' % (n1, p1, n2, p2), ok,
            'd=%.2f 顶部近似图对（顺序调用，第二次可能命中缓存）' % d)
    else:
        rec('a4', 'cache-collision', '无近似跨阶段图对', '无', True, '样本内未发现碰撞风险')


def name_path(name):
    if name.startswith('f_'):
        return '_video/full_frames/%s.jpg' % name
    if name.startswith('r_'):
        return '_video/result_frames/%s.jpg' % name
    return '.uploads/%s' % name


def _sig(img):
    H = img.shape[0]
    top = img[0:max(1, int(H * 0.35)), :]
    return cv2.resize(top, (160, 45), interpolation=cv2.INTER_AREA).astype(np.float32)


# ---------------------------------------------------------------------------
# b) recognize_bans
# ---------------------------------------------------------------------------
def test_bans(bank):
    print('\n=== b) recognize_bans: 金标准真机截图 ===')
    img = load(GOLD)
    reset_phase_cache()
    phase, _ = L.detect_phase(img)
    rec('b0', 'gold-phase', 'pick', phase, phase == 'pick', '金标准图阶段')

    t0 = time.time()
    bans = L.recognize_bans(img, bank)
    dt = (time.time() - t0) * 1000
    blue = [b['name'] for b in bans if b['side'] == 'blue']
    red = [b['name'] for b in bans if b['side'] == 'red']
    conf_blue = [b['confident'] for b in bans if b['side'] == 'blue']
    conf_red = [b['confident'] for b in bans if b['side'] == 'red']
    print('    blue=%s  conf=%s' % (blue, conf_blue))
    print('    red =%s  conf=%s' % (red, conf_red))
    rec('b1', 'ban-count-blue', '5', str(len(blue)), len(blue) == 5, '金标准蓝 5')
    rec('b2', 'ban-count-red', '4', str(len(red)), len(red) == 4,
        '金标准红 4（第 5 位空 ban，应被跳过）')
    rec('b3', 'ban-blue-names', ' / '.join(GOLD_BANS_BLUE), ' / '.join(blue),
        blue == GOLD_BANS_BLUE)
    rec('b4', 'ban-red-names', ' / '.join(GOLD_BANS_RED[:4]), ' / '.join(red),
        red == GOLD_BANS_RED[:4])
    total_ok = sum(1 for b in bans if b['confident'])
    rec('b5', 'ban-confident', '9', str(total_ok), total_ok >= 8,
        '高置信个数（gap>=0.003）')

    # 不同分辨率鲁棒性：把金标准图缩放到 1280x576 / 2400x1080 再识别
    for (w, h) in ((1280, 576), (2400, 1080), (2772, 1280), (1517, 682)):
        im2 = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
        b2 = L.recognize_bans(im2, bank)
        names = [b['name'] for b in b2 if b['side'] == 'blue']
        ok = names == GOLD_BANS_BLUE
        rec('b6', 'ban-resize-%dx%d' % (w, h), ' / '.join(GOLD_BANS_BLUE),
            ' / '.join(names) or '(空)', ok,
            '红:%s' % (' / '.join(b['name'] for b in b2 if b['side'] == 'red') or '(空)'), round(dt, 1))

    # ban 识别耗时（单帧）
    print('    recognize_bans 单帧耗时 %.0f ms' % dt)

    # 空 ban 位门限：把金标准顶部 ban 条涂成纯色 → 应识别 0 个
    img_empty = load(GOLD).copy()
    H2 = img_empty.shape[0]
    img_empty[0:int(H2 * 0.14), :] = (40, 30, 60)
    b3 = L.recognize_bans(img_empty, bank)
    rec('b7', 'ban-empty-strip(合成)', '0 个', '%d 个' % len(b3), len(b3) == 0,
        '空 ban 位应被 std 门限跳过')

    return bans


# ---------------------------------------------------------------------------
# c) recognize_picks
# ---------------------------------------------------------------------------
def build_pick_montage(img, picks, bank, out):
    """每个 pick 位：左=实际裁剪，右=top3 候选官方头像。供人工核对。"""
    half = int(round(img.shape[1] * 0.0234))
    cells = []
    manifest = {m['id']: m['name'] for m in
                json.load(open('avatars/manifest.json', encoding='utf-8'))}
    for p in picks:
        x = int(round(img.shape[1] * (0.0859 if p['side'] == 'blue' else 1 - 0.0859)))
        cy = int(round(img.shape[0] * (0.1713 + 0.1620 * (p['index'] - 1))))
        crop = img[max(0, cy - half):cy + half, max(0, x - half):x + half]
        if crop.size == 0:
            continue
        left = cv2.resize(crop, (150, 150), interpolation=cv2.INTER_CUBIC)
        cell = np.zeros((186, 150 + 3 * 100, 3), np.uint8)
        cell[36:186, 0:150] = left
        label = '%s%d %s%s' % (p['side'][0].upper(), p['index'],
                               p['name'] or '(空)', '' if p['confident'] else '?')
        cv2.putText(cell, label, (2, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                    (0, 255, 0) if p['confident'] else (0, 165, 255), 2)
        # top3 候选
        fused = bank.fuse([bank.ranks(crop)])
        for j, (hid, sc) in enumerate(fused[:3]):
            av = load('avatars/%s.jpg' % hid)
            if av is None:
                continue
            av = cv2.resize(av, (96, 96), interpolation=cv2.INTER_AREA)
            y0 = 60
            cell[y0:y0 + 96, 150 + j * 100 + 2:150 + j * 100 + 98] = av
            cv2.putText(cell, '%s %.4f' % (hid[:8], sc), (150 + j * 100 + 2, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 200, 200), 1)
            cv2.putText(cell, manifest.get(hid, '')[:5], (150 + j * 100 + 2, 176),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        cells.append(cell)
    if cells:
        cv2.imwrite(out, np.vstack(cells))
        print('    montage -> %s' % out)


def test_picks(bank):
    print('\n=== c) recognize_picks: 金标准真机截图 ===')
    img = load(GOLD)
    reset_picks_cache()
    t0 = time.time()
    picks = L.recognize_picks(img, bank)
    dt = (time.time() - t0) * 1000
    print('    raw: %s' % ' | '.join(
        '%s%d=%s%s' % (p['side'][0].upper(), p['index'], p['name'] or '(空)',
                       '' if p['confident'] else '?') for p in picks))
    rec('c1', 'pick-count-returned', '10', str(len(picks)), len(picks) == 10, '左右各 5 位')
    filled = [p for p in picks if not p['empty']]
    empty = [p for p in picks if p['empty']]
    rec('c2', 'pick-filled', '9（红 5 为空位）', str(len(filled)), len(filled) == 9)
    rec('c3', 'pick-empty', '1（R5）',
        '%d (%s)' % (len(empty), ','.join('%s%d' % (p['side'][0].upper(), p['index']) for p in empty)),
        len(empty) == 1 and empty[0]['side'] == 'red' and empty[0]['index'] == 5)
    dup = {}
    for p in filled:
        dup[p['hero_id']] = dup.get(p['hero_id'], 0) + 1
    dups = {k: v for k, v in dup.items() if v > 1}
    rec('c4', 'pick-no-duplicate', '无重复英雄', '重复: %s' % (dups or '无'), not dups,
        '同局 10 人不应出现重复英雄')
    conf = sum(1 for p in filled if p['confident'])
    rec('c5', 'pick-confident', '>=7/9', '%d/9' % conf, conf >= 7, '高置信占比')
    print('    单帧耗时 %.0f ms' % dt)
    os.makedirs(OUT_DIR, exist_ok=True)
    build_pick_montage(img, picks, bank, os.path.join(OUT_DIR, 'picks_montage.png'))
    return picks


# ---------------------------------------------------------------------------
# d) detect_player_floor
# ---------------------------------------------------------------------------
def test_player_floor():
    print('\n=== d) detect_player_floor ===')
    # 金标准图：玩家自己的行带「预选/更改」UI（截图里在左侧 5 行列表内）
    for name, path in (('gold', GOLD),
                       ('upload_final_shot_1787553938944', '.uploads/shot_1787553938944.jpg'),
                       ('upload_pick_shot_1787581474389', '.uploads/shot_1787581474389.jpg')):
        img = load(path)
        t0 = time.time()
        floor, names = L.detect_player_floor(img)
        dt = (time.time() - t0) * 1000
        ok = floor is None or (1 <= floor <= 5)
        rec('d1', 'floor-range(%s)' % name, 'None 或 1~5', str(floor), ok,
            '候选行数=%d 耗时=%.0fms' % (len(names), dt))
        if names:
            print('    %s: floor=%s names=%s' % (
                name, floor,
                [(n['text'], round(n['y']), round(n['ratio'], 3)) for n in names]))

    # 反例：非 BP 画面（游戏内/结算）不应崩溃
    for name, path in (('gameplay_f_241', '_video/full_frames/f_241.jpg'),
                       ('result_r_028', '_video/result_frames/r_028.jpg'),
                       ('webui', '.uploads/shot_1787553851489.jpg')):
        img = load(path)
        try:
            floor, names = L.detect_player_floor(img)
            rec('d2', 'floor-nocrash(%s)' % name, '不崩溃', 'floor=%s n=%d' % (floor, len(names)),
                True)
        except Exception as e:
            rec('d2', 'floor-nocrash(%s)' % name, '不崩溃', 'EXC %s' % e, False)

    # 稳定性：同一图连续 2 次结果一致（OCR 结果缓存/随机性）
    img = load(GOLD)
    f1, _ = L.detect_player_floor(img)
    f2, _ = L.detect_player_floor(img)
    rec('d3', 'floor-stable(gold)', '两次一致', '%s / %s' % (f1, f2), f1 == f2)


# ---------------------------------------------------------------------------
# e) detect_game_result
# ---------------------------------------------------------------------------
def test_game_result(bank):
    print('\n=== e) detect_game_result ===')
    for name, exp in RESULT_EXPECT.items():
        img = load('_video/result_frames/%s.jpg' % name)
        t0 = time.time()
        gr = L.detect_game_result(img)
        dt = (time.time() - t0) * 1000
        ok = (gr['is_result'] == exp['is_result'] and gr['result'] == exp['result']
              and gr['delta'] == exp['delta'] and gr['is_mvp'] == exp['is_mvp'])
        rec('e1', name, json.dumps(exp, ensure_ascii=False),
            json.dumps({k: gr[k] for k in ('is_result', 'result', 'is_mvp', 'delta')},
                       ensure_ascii=False), ok, '耗时=%.0fms' % dt)

    # 反例：不应把游戏内/ban 界面误判为结算
    for name, path in (('gameplay_f_251', '_video/full_frames/f_251.jpg'),
                       ('ban_f_081', '_video/full_frames/f_081.jpg'),
                       ('final_upload', '.uploads/shot_1787580760612.jpg')):
        img = load(path)
        gr = L.detect_game_result(img)
        rec('e2', 'result-negative(%s)' % name, 'is_result=False',
            'is_result=%s' % gr['is_result'], gr['is_result'] is False,
            'texts=%s' % (gr['texts'][:4] if gr['texts'] else []))

    # MVP 帧的玩家英雄（圆形头像）
    img = load('_video/result_frames/r_029.jpg')
    h = L.detect_result_hero(img, bank)
    rec('e3', 'result-hero(r_029)', '猪八戒(confident)',
        '%s score=%s gap=%s confident=%s' % (h['name'], h['score'], h['gap'], h['confident']) if h else 'None',
        bool(h) and h['name'] == '猪八戒' and h['confident'])

    img = load('_video/result_frames/r_028.jpg')   # 非 MVP 帧 → 应低置信
    h2 = L.detect_result_hero(img, bank)
    rec('e4', 'result-hero(r_028 非MVP)', 'confident=False',
        'name=%s confident=%s' % (h2['name'], h2['confident']) if h2 else 'None',
        (h2 is None) or (h2['confident'] is False))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--phase', action='store_true')
    ap.add_argument('--bans', action='store_true')
    ap.add_argument('--picks', action='store_true')
    ap.add_argument('--floor', action='store_true')
    ap.add_argument('--result', action='store_true')
    args = ap.parse_args()
    only = args.phase or args.bans or args.picks or args.floor or args.result

    os.makedirs(OUT_DIR, exist_ok=True)
    print('=' * 70)
    print('  测试小鱼 · 识别函数验证  %s' % time.strftime('%Y-%m-%d %H:%M:%S'))
    print('=' * 70)

    if not only or args.phase:
        test_phase_frames()
        test_phase_uploads()
        test_phase_result_frames()
        labeled = [(k, v[0]) for k, v in PHASE_EXPECT_FRAMES.items()] + \
                  [(k, v[0]) for k, v in PHASE_EXPECT_UPLOADS.items()]
        test_phase_cache(labeled)

    need_bank = (not only) or args.bans or args.picks or args.result
    bank = None
    if need_bank:
        t0 = time.time()
        print('\n[准备] 加载特征库（133 英雄）...')
        bank = L.FeatureBank()
        print('[准备] 完成，%.2f 秒' % (time.time() - t0))

    if not only or args.bans:
        test_bans(bank)
    if not only or args.picks:
        test_picks(bank)
    if not only or args.floor:
        test_player_floor()
    if not only or args.result:
        test_game_result(bank)

    # 汇总
    total = len(RECORDS)
    passed = sum(1 for r in RECORDS if r['pass'])
    print('\n' + '=' * 70)
    print('  小计: %d 项 / 通过 %d / 失败 %d' % (total, passed, total - passed))
    print('=' * 70)
    json.dump({'generated': time.strftime('%Y-%m-%d %H:%M:%S'),
               'total': total, 'passed': passed, 'failed': total - passed,
               'records': RECORDS},
              open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('明细已写入 %s' % OUT_JSON)
    return 0 if passed == total else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
