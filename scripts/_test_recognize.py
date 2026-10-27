# -*- coding: utf-8 -*-
"""测试小鱼 · 识别函数批量验证（只读样本 + import 现有函数，不改源码）

覆盖：
  a) detect_phase       —— 视频帧 31 张（每 10 帧取样）+ 真机截图 25 张 + 结算帧 2 张 + 帧差缓存
  b) recognize_bans     —— 金标准真机截图（顶部 5+5 ban 位）+ 多分辨率不变性 + 空位门限
  c) recognize_picks    —— 金标准逐位比对（蓝 5 / 红 4+空1）+ 多分辨率 + 其他截图
  d) detect_player_floor—— 金标准 / 1280x576 / 真实昵称 / 非 BP 图
  e) detect_game_result —— r_028 / r_029 + 反例 + 结算玩家英雄

跑法：
  python scripts/_test_recognize.py             # 全量（约 3~4 分钟，OCR 慢）
  python scripts/_test_recognize.py --phase     # 只跑阶段
  python scripts/_test_recognize.py --bans      # 只跑 ban
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
# 金标准（测试小鱼逐张看图标注，不依赖被测 OCR）
# ---------------------------------------------------------------------------
PHASE_EXPECT_FRAMES = {
    'f_001': ('other', {'other'}),   # 匹配/个人主页
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
    'f_221': ('final', {'final', 'pick'}),  # 准备前往发育路 0
    'f_231': ('other', {'other'}),   # 英雄加载
    'f_241': ('other', {'other'}),   # 游戏内
    'f_251': ('other', {'other'}),
    'f_261': ('other', {'other'}),
    'f_271': ('other', {'other'}),
    'f_281': ('other', {'other'}),
    'f_291': ('other', {'other'}),
    'f_301': ('other', {'other'}),
}

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
    'shot_1787925958737.jpg': ('ban', {'ban'}),      # 禁用结束（ban 结果面板）
    'shot_1787927467197.jpg': ('ban', {'ban'}),      # 禁用结束
    'shot_1787928343974.jpg': ('pick', {'pick'}),    # 等待其他玩家选择 19
}

# 金标准阵容（用户给定，实测对应 recognize_picks 的 10 个 pick 位）
GOLD_PICKS_BLUE = ['廉颇', '上官婉儿', '敖隐', '姬小满', '百里玄策']
GOLD_PICKS_RED = ['弈星', '蚩奼', '大禹', '元歌', '']    # 红 5 空

RESULT_EXPECT = {
    'r_028': {'is_result': True, 'result': 'WIN', 'delta': 13, 'is_mvp': False},
    'r_029': {'is_result': True, 'result': 'WIN', 'delta': 13, 'is_mvp': True},
}

RECORDS = []


def load(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def name_path(name):
    if name.startswith('f_'):
        return '_video/full_frames/%s.jpg' % name
    if name.startswith('r_'):
        return '_video/result_frames/%s.jpg' % name
    return '.uploads/%s' % name


def reset_phase_cache():
    L._PHASE_CACHE['sig'] = None
    L._PHASE_CACHE['phase'] = 'other'
    L._PHASE_CACHE['score'] = 0.0


def reset_picks_cache():
    L._PICKS_CACHE['sig'] = None
    L._PICKS_CACHE['picks'] = None


def _sig(img):
    H = img.shape[0]
    top = img[0:max(1, int(H * 0.35)), :]
    return cv2.resize(top, (160, 45), interpolation=cv2.INTER_AREA).astype(np.float32)


def rec(case, item, expected, actual, ok, note='', ms=None):
    r = {'case': case, 'item': item, 'expected': expected, 'actual': actual,
         'pass': bool(ok), 'note': note, 'ms': ms}
    RECORDS.append(r)
    print('[%s] %-4s %-34s expect=%-10s actual=%s %s' % (
        'PASS' if ok else 'FAIL', case, item, expected, actual,
        note if note else ''))
    return r


# ---------------------------------------------------------------------------
# a) detect_phase
# ---------------------------------------------------------------------------
def test_phase_frames():
    print('\n=== a1) detect_phase: 视频帧（1280x720，每 10 帧取样 31 张）===')
    for name, (exp, allow) in PHASE_EXPECT_FRAMES.items():
        img = load(name_path(name))
        if img is None:
            rec('a1', name, exp, 'UNREADABLE', False)
            continue
        reset_phase_cache()
        t0 = time.time()
        phase, score = L.detect_phase(img)
        dt = (time.time() - t0) * 1000
        rec('a1', name, exp, phase, phase in allow,
            '%dx%d score=%.2f' % (img.shape[1], img.shape[0], score), round(dt, 1))


def test_phase_uploads():
    print('\n=== a2) detect_phase: 真机截图（去重后 25 张，多分辨率）===')
    for name, (exp, allow) in PHASE_EXPECT_UPLOADS.items():
        img = load(name_path(name))
        if img is None:
            rec('a2', name, exp, 'UNREADABLE', False)
            continue
        reset_phase_cache()
        t0 = time.time()
        phase, score = L.detect_phase(img)
        dt = (time.time() - t0) * 1000
        rec('a2', name, exp, phase, phase in allow,
            '%dx%d score=%.2f' % (img.shape[1], img.shape[0], score), round(dt, 1))


def test_phase_result_frames():
    print('\n=== a3) detect_phase: 结算帧（应为 other）===')
    for name in ('r_028', 'r_029'):
        img = load(name_path(name))
        reset_phase_cache()
        phase, score = L.detect_phase(img)
        rec('a3', name, 'other', phase, phase == 'other', 'score=%.2f' % score)


def test_phase_cache(labeled):
    """帧差缓存：顶部 35% 缩到 160x45 后平均差 < 3.0 就复用上次 OCR 结果。

    判定标准不是「零错误」，而是「缓存不引入新错误」：
    顺序喂帧的结果应与逐帧重置缓存(a1/a2)完全一致。
    """
    print('\n=== a4) detect_phase: 帧差缓存行为 ===')
    baseline = {r['item']: r['actual'] for r in RECORDS if r['case'] in ('a1', 'a2')}
    reset_phase_cache()
    mismatch = []
    seq = {}
    for name, exp in labeled:
        img = load(name_path(name))
        if img is None:
            continue
        phase, _ = L.detect_phase(img)
        seq[name] = phase
        if phase != baseline.get(name, exp):
            mismatch.append('%s: 逐帧=%s/顺序=%s' % (name, baseline.get(name, exp), phase))
    rec('a4', 'sequence(cache on, 56 张)', '与逐帧结果一致（无新增错误）',
        '%d 处新增错误' % len(mismatch), len(mismatch) == 0, '; '.join(mismatch[:6]))

    sigs = []
    for name, exp in labeled:
        img = load(name_path(name))
        if img is None:
            continue
        sigs.append((name, exp, _sig(img)))
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
        p2, _ = L.detect_phase(load(name_path(n2)))
        ok = (p1 == ph1 and p2 == ph2)
        rec('a4', 'cache-collision', '%s=>%s, %s=>%s' % (n1, ph1, n2, ph2),
            '%s=>%s, %s=>%s' % (n1, p1, n2, p2), ok, 'd=%.2f' % d)
    else:
        rec('a4', 'cache-collision', '无跨阶段近似图对', '无', True, '样本内无碰撞风险')

    sigs = []
    for name, exp in labeled:
        img = load(name_path(name))
        if img is None:
            continue
        sigs.append((name, exp, _sig(img)))
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
        p2, _ = L.detect_phase(load(name_path(n2)))
        ok = (p1 == ph1 and p2 == ph2)
        rec('a4', 'cache-collision', '%s=>%s, %s=>%s' % (n1, ph1, n2, ph2),
            '%s=>%s, %s=>%s' % (n1, p1, n2, p2), ok, 'd=%.2f' % d)
    else:
        rec('a4', 'cache-collision', '无跨阶段近似图对', '无', True, '样本内无碰撞风险')


# ---------------------------------------------------------------------------
# b) recognize_bans
# ---------------------------------------------------------------------------
def build_ban_montage(img, bank, out):
    """10 个 ban 位：左=实际裁剪，右=top3 候选官方头像（供人工核对）。"""
    H, W = img.shape[:2]
    r = max(8, int(round(W * L.BAN_R_RATIO)))
    cy = int(round(H * L.BAN_Y_RATIO))
    manifest = {m['id']: m['name'] for m in
                json.load(open('avatars/manifest.json', encoding='utf-8'))}
    rows = []
    for side, ratios in (('blue', L.BAN_X_RATIOS),
                         ('red', [1.0 - x for x in L.BAN_X_RATIOS])):
        cells = []
        for idx, xr in enumerate(ratios, 1):
            cx = int(round(W * xr))
            crop = L.crop_avatar(img, cx, cy, r)
            cell = np.zeros((206, 150 + 3 * 104, 3), np.uint8)
            cell[46:196, 0:150] = cv2.resize(crop, (150, 150), interpolation=cv2.INTER_CUBIC)
            cv2.putText(cell, '%s%d' % (side[0].upper(), idx), (2, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
            fused = bank.fuse([bank.ranks(crop)])
            for j, (hid, sc) in enumerate(fused[:3]):
                av = load('avatars/%s.jpg' % hid)
                if av is None:
                    continue
                av = cv2.resize(av, (96, 96), interpolation=cv2.INTER_AREA)
                x0 = 152 + j * 104
                cell[56:152, x0:x0 + 96] = av
                cv2.putText(cell, '%.4f' % sc, (x0, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (0, 200, 255), 1)
                cv2.putText(cell, manifest.get(hid, '')[:4], (x0, 176), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 1)
                cv2.putText(cell, hid[:10], (x0, 196), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 180, 180), 1)
            cells.append(cell)
        rows.append(np.hstack(cells))
    cv2.imwrite(out, np.vstack(rows))
    print('    montage -> %s' % out)


def test_bans(bank):
    print('\n=== b) recognize_bans: 金标准真机截图 ===')
    img = load(GOLD)
    reset_phase_cache()
    phase, _ = L.detect_phase(img)
    rec('b0', 'gold-phase', 'pick', phase, phase == 'pick', '金标准图阶段')

    t0 = time.time()
    bans = L.recognize_bans(img, bank)
    dt = (time.time() - t0) * 1000
    blue = [b for b in bans if b['side'] == 'blue']
    red = [b for b in bans if b['side'] == 'red']
    print('    blue: %s' % ' / '.join('%s(%.4f,gap%.4f%s)' % (
        b['name'], b['score'], b['gap'], '' if b['confident'] else '?') for b in blue))
    print('    red : %s' % ' / '.join('%s(%.4f,gap%.4f%s)' % (
        b['name'], b['score'], b['gap'], '' if b['confident'] else '?') for b in red))
    rec('b1', 'ban-count-blue', '5', str(len(blue)), len(blue) == 5, '金标准图左侧 5 个 ban 位均非空')
    rec('b2', 'ban-count-red', '5', str(len(red)), len(red) == 5, '金标准图右侧 5 个 ban 位均非空')
    names = [b['name'] for b in bans]
    rec('b3', 'ban-no-duplicate', '10 个各不相同', '重复: %s' % ([n for n in set(names) if names.count(n) > 1] or '无'),
        len(names) == len(set(names)))
    conf = sum(1 for b in bans if b['confident'])
    rec('b4', 'ban-confident', '>=8/10', '%d/10' % conf, conf >= 8, 'gap>=0.003 视为高置信')
    rec('b5', 'ban-single-frame-ms', '<800ms', '%.0fms' % dt, dt < 800,
        '10 个 ban 位 × 133 英雄 ORB 匹配（轮询间隔 2s，可接受）')

    # ban 与 pick 不应重叠（禁掉的英雄不可能被选）
    picks = L.recognize_picks(img, bank)
    picked = {p['name'] for p in picks if p['hero_id']}
    overlap = [n for n in names if n in picked]
    rec('b6', 'ban-vs-pick-overlap', '空集', '重叠: %s' % (overlap or '无'), not overlap,
        '对局常识校验')

    # 缩放鲁棒性（注意：真实截图是原生分辨率，缩放到非常规尺寸属压力测试）
    diffs = []
    for (w, h) in ((1280, 576), (2400, 1080), (2772, 1280), (1517, 682)):
        im2 = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
        b2 = L.recognize_bans(im2, bank)
        got = set(b['name'] for b in b2)
        diffs.append('%dx%d:%d 个/差异 %d' % (w, h, len(b2), len(got ^ set(names))))
        rec('b7', 'ban-resize-%dx%d' % (w, h), '仍检出 10 个 ban 位',
            '%d 个' % len(b2), len(b2) == 10,
            '与原生同名 %d/10' % (10 - len(got ^ set(names))))
    print('    缩放压力测试: %s' % ' | '.join(diffs))

    # 空 ban 位门限：把顶部 ban 条涂成纯色 → 应识别 0 个
    img_empty = img.copy()
    img_empty[0:int(img.shape[0] * 0.14), :] = (40, 30, 60)
    b3 = L.recognize_bans(img_empty, bank)
    rec('b8', 'ban-empty-strip(合成)', '0 个', '%d 个' % len(b3), len(b3) == 0,
        '空 ban 位应被 std 门限跳过')

    build_ban_montage(img, bank, os.path.join(OUT_DIR, 'bans_montage.png'))

    # 全部真机截图跑一遍：不崩溃 + 统计
    print('\n--- 全部真机截图 ban 识别（无金标准，只做鲁棒性统计）---')
    stats = []
    fail = []
    for name in PHASE_EXPECT_UPLOADS:
        im = load(name_path(name))
        if im is None:
            continue
        try:
            bs = L.recognize_bans(im, bank)
            stats.append('%s:%d' % (name[-8:-4], len(bs)))
        except Exception as e:
            fail.append('%s(%s)' % (name, e))
    rec('b9', 'ban-all-uploads-no-crash', '0 崩溃', '%d 崩溃' % len(fail),
        not fail, '命中个数: %s' % ' '.join(stats))
    return bans


# ---------------------------------------------------------------------------
# c) recognize_picks
# ---------------------------------------------------------------------------
def build_pick_montage(img, picks, bank, out):
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
        cell = np.zeros((206, 150 + 3 * 104, 3), np.uint8)
        cell[46:196, 0:150] = cv2.resize(crop, (150, 150), interpolation=cv2.INTER_CUBIC)
        label = '%s%d %s%s' % (p['side'][0].upper(), p['index'], p['name'] or '(空)',
                               '' if p['confident'] else '?')
        cv2.putText(cell, label, (2, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                    (0, 255, 0) if p['confident'] else (0, 165, 255), 2)
        fused = bank.fuse([bank.ranks(crop)])
        for j, (hid, sc) in enumerate(fused[:3]):
            av = load('avatars/%s.jpg' % hid)
            if av is None:
                continue
            av = cv2.resize(av, (96, 96), interpolation=cv2.INTER_AREA)
            x0 = 152 + j * 104
            cell[56:152, x0:x0 + 96] = av
            cv2.putText(cell, '%.4f' % sc, (x0, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (0, 200, 255), 1)
            cv2.putText(cell, manifest.get(hid, '')[:4], (x0, 176), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 1)
            cv2.putText(cell, hid[:10], (x0, 196), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 180, 180), 1)
        cells.append(cell)
    if cells:
        cv2.imwrite(out, np.vstack(cells))
        print('    montage -> %s' % out)


def compare_gold_picks(picks, case_prefix):
    """与金标准逐位比对，返回 (正确数, 明细)"""
    got_blue = [p['name'] or '' for p in picks if p['side'] == 'blue']
    got_red = [p['name'] or '' for p in picks if p['side'] == 'red']
    exp_blue = GOLD_PICKS_BLUE
    exp_red = GOLD_PICKS_RED
    ok_blue = got_blue == exp_blue
    ok_red = got_red == exp_red
    detail = []
    for i in range(min(5, len(exp_blue))):
        g = got_blue[i] if i < len(got_blue) else '<缺>'
        if g != exp_blue[i]:
            detail.append('B%d 期望%s 实际%s' % (i + 1, exp_blue[i], g))
    for i in range(min(5, len(exp_red))):
        g = got_red[i] if i < len(got_red) else '<缺>'
        if g != exp_red[i]:
            detail.append('R%d 期望%s 实际%s' % (i + 1, exp_red[i], g or '(空)'))
    correct = sum(1 for i in range(5) if i < len(got_blue) and got_blue[i] == exp_blue[i]) + \
        sum(1 for i in range(5) if i < len(got_red) and got_red[i] == exp_red[i])
    rec(case_prefix + 'a', 'pick-gold-blue', ' / '.join(exp_blue), ' / '.join(got_blue),
        ok_blue)
    rec(case_prefix + 'b', 'pick-gold-red', ' / '.join(x or '(空)' for x in exp_red),
        ' / '.join(x or '(空)' for x in got_red), ok_red, '金标准红 5 为空位')
    return correct, detail


def test_picks(bank):
    print('\n=== c) recognize_picks: 金标准真机截图（逐位比对）===')
    img = load(GOLD)
    reset_picks_cache()
    t0 = time.time()
    picks = L.recognize_picks(img, bank)
    dt = (time.time() - t0) * 1000
    print('    ' + ' | '.join('%s%d=%s%s' % (p['side'][0].upper(), p['index'],
                                            p['name'] or '(空)',
                                            '' if p['confident'] else '?') for p in picks))
    rec('c1', 'pick-count', '10', str(len(picks)), len(picks) == 10)
    filled = [p for p in picks if not p['empty']]
    empty = [p for p in picks if p['empty']]
    rec('c2', 'pick-filled-count', '9', str(len(filled)), len(filled) == 9)
    rec('c3', 'pick-empty-slot', 'R5 空',
        ','.join('%s%d' % (p['side'][0].upper(), p['index']) for p in empty) or '(无空位)',
        len(empty) == 1 and empty[0]['side'] == 'red' and empty[0]['index'] == 5)
    correct, detail = compare_gold_picks(picks, 'c4')
    rec('c4c', 'pick-gold-accuracy', '10/10 位', '%d/10 位' % correct, correct == 10,
        '; '.join(detail[:4]))
    dup = {}
    for p in filled:
        dup[p['name']] = dup.get(p['name'], 0) + 1
    dups = [k for k, v in dup.items() if v > 1]
    rec('c5', 'pick-no-duplicate', '无重复', '重复: %s' % (dups or '无'), not dups)
    conf = sum(1 for p in filled if p['confident'])
    rec('c6', 'pick-confident', '>=7/9', '%d/9' % conf, conf >= 7,
        '低于 gap 0.003 的正确结果会被标记为低置信: %s' % [
            '%s%d' % (p['side'][0].upper(), p['index']) for p in filled if not p['confident']])
    print('    单帧耗时 %.0f ms' % dt)
    build_pick_montage(img, picks, bank, os.path.join(OUT_DIR, 'picks_montage.png'))

    # 缩放压力测试（真实截图是原生分辨率，缩放属压力测试）
    print('\n--- 缩放压力测试（金标准图缩放）---')
    for (w, h) in ((1280, 576), (2400, 1080), (2772, 1280), (1517, 682)):
        im2 = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
        reset_picks_cache()
        ps = L.recognize_picks(im2, bank)
        got = [p['name'] or '' for p in ps if p['side'] == 'blue'] + \
              [p['name'] or '' for p in ps if p['side'] == 'red']
        exp = GOLD_PICKS_BLUE + GOLD_PICKS_RED
        n_ok = sum(1 for i in range(min(len(got), 10)) if got[i] == exp[i])
        bad = [('%s≠%s' % (got[i], exp[i])) for i in range(min(len(got), 10)) if got[i] != exp[i]]
        rec('c7', 'pick-resize-%dx%d' % (w, h), '>=9/10 位', '%d/10 位' % n_ok, n_ok >= 9,
            '差异: %s' % (bad or '无'))

    # 其他真机截图：10 位 / 无重复 / 不崩溃（真实英雄 pick 画面）
    print('\n--- 其他真机截图 pick 识别（真实选将画面，结构校验）---')
    cases = [('shot_1787569134699.jpg', 8), ('shot_1787580760612.jpg', 9),
             ('shot_1787581474389.jpg', 8), ('shot_1787651841122.jpg', 9)]
    for name, min_filled in cases:
        im = load(name_path(name))
        reset_picks_cache()
        try:
            ps = L.recognize_picks(im, bank)
        except Exception as e:
            rec('c8', 'pick-other(%s)' % name, '不崩溃', 'EXC %s' % e, False)
            continue
        filled2 = [p for p in ps if not p['empty']]
        names2 = [p['name'] for p in filled2]
        dups2 = [n for n in set(names2) if names2.count(n) > 1]
        ok = len(ps) == 10 and len(filled2) >= min_filled and not dups2
        rec('c8', 'pick-other(%s)' % name, '10 位/>=%d 有英雄/无重复' % min_filled,
            '%d 位/%d 有英雄/重复%s' % (len(ps), len(filled2), dups2 or '无'),
            ok, '%dx%d' % (im.shape[1], im.shape[0]))

    # 分路图标画面（尚未选将）：不应识别出高置信英雄
    print('\n--- 分路图标画面（shot_1787928343974，玩家尚未选将）---')
    im = load(name_path('shot_1787928343974.jpg'))
    reset_picks_cache()
    ps = L.recognize_picks(im, bank)
    filled3 = [p for p in ps if not p['empty']]
    conf3 = [p for p in filled3 if p['confident']]
    dups3 = [n for n in set(p['name'] for p in filled3)
             if [q['name'] for q in filled3].count(n) > 1]
    rec('c9', 'pick-lane-icons(分路图标)', '0 个高置信英雄（画面里没有英雄头像）',
        '识别出 %d 个「英雄」，其中高置信 %d 个: %s；重复=%s' % (
            len(filled3), len(conf3),
            ', '.join('%s%s' % (p['side'][0].upper() + str(p['index']), p['name']) for p in filled3),
            dups3 or '无'),
        len(conf3) == 0 and not dups3,
        '分路图标（蓝/红菱形）被当成英雄头像，且出现同队重复英雄')


# ---------------------------------------------------------------------------
# d) detect_player_floor
# ---------------------------------------------------------------------------
def test_player_floor():
    print('\n=== d) detect_player_floor ===')
    cases = [
        # (标签, 路径, 人工推定楼层, 依据)
        ('gold(1920x864)', GOLD, 3, '金黄色名字=巅峰召唤师8（第3行，带发送按钮/战绩）'),
        ('final_shot_1787553938944', '.uploads/shot_1787553938944.jpg', 3, '同一账号同一局'),
        ('pick_shot_1787569134699(1280x576)', '.uploads/shot_1787569134699.jpg', 4,
         '第4行名字金色 + 分路段位 S 徽章'),
    ]
    for tag, path, expect_floor, why in cases:
        img = load(path)
        t0 = time.time()
        floor, names = L.detect_player_floor(img)
        dt = (time.time() - t0) * 1000
        rec('d1', 'floor(%s)' % tag, str(expect_floor), str(floor), floor == expect_floor,
            '%s；候选行=%d；耗时=%.0fms' % (why, len(names), dt))
        if names:
            print('    检测到的行: %s' % [(n['text'], int(n['y']), round(n['ratio'], 3))
                                       for n in names])

    # 真实昵称（非「巅峰召唤师N」）时返回 None —— 记录为已知限制
    img = load('.uploads/shot_1787581474389.jpg')
    floor, names = L.detect_player_floor(img)
    rec('d2', 'floor(真实昵称 shot_1787581474389)', 'None 或 1~5',
        str(floor), floor is None or 1 <= floor <= 5,
        '该图左侧为真实昵称且被「点击发送战绩」弹窗遮挡，候选行=%d' % len(names))

    # 非 BP 画面不应崩溃
    for tag, path in (('gameplay_f_241', '_video/full_frames/f_241.jpg'),
                      ('result_r_028', '_video/result_frames/r_028.jpg'),
                      ('webui', '.uploads/shot_1787553851489.jpg')):
        try:
            floor, names = L.detect_player_floor(load(path))
            rec('d3', 'floor-nocrash(%s)' % tag, '不崩溃',
                'floor=%s n=%d' % (floor, len(names)), True)
        except Exception as e:
            rec('d3', 'floor-nocrash(%s)' % tag, '不崩溃', 'EXC %s' % e, False)

    # 稳定性
    img = load(GOLD)
    f1, _ = L.detect_player_floor(img)
    f2, _ = L.detect_player_floor(img)
    rec('d4', 'floor-stable(gold)', '两次一致', '%s / %s' % (f1, f2), f1 == f2)


# ---------------------------------------------------------------------------
# e) detect_game_result
# ---------------------------------------------------------------------------
def test_game_result(bank):
    print('\n=== e) detect_game_result ===')
    for name, exp in RESULT_EXPECT.items():
        img = load(name_path(name))
        t0 = time.time()
        gr = L.detect_game_result(img)
        dt = (time.time() - t0) * 1000
        ok = all(gr[k] == exp[k] for k in exp)
        rec('e1', name, json.dumps(exp, ensure_ascii=False),
            json.dumps({k: gr[k] for k in exp}, ensure_ascii=False), ok,
            '耗时=%.0fms' % dt)

    print('\n--- 反例（不应误判为结算）---')
    for tag, path in (('gameplay_f_251', '_video/full_frames/f_251.jpg'),
                      ('ban_f_081', '_video/full_frames/f_081.jpg'),
                      ('final_upload', '.uploads/shot_1787580760612.jpg')):
        gr = L.detect_game_result(load(path))
        rec('e2', 'result-negative(%s)' % tag, 'is_result=False',
            'is_result=%s' % gr['is_result'], gr['is_result'] is False,
            'OCR 命中: %s' % (gr['texts'][:3] if gr['texts'] else []))

    print('\n--- 结算 MVP 玩家英雄（detect_result_hero）---')
    h = L.detect_result_hero(load(name_path('r_029')), bank)
    rec('e3', 'result-hero(r_029) 名称', '猪八戒',
        h['name'] if h else 'None', bool(h) and h['name'] == '猪八戒',
        'score=%.4f gap=%.4f' % (h['score'], h['gap']) if h else '')
    rec('e4', 'result-hero(r_029) confident', 'True',
        str(h['confident']) if h else 'None', bool(h) and h['confident'] is True,
        'API 依赖 confident 才回填 my_hero_id；gap 阈值 %.4f' % 0.0015)

    h2 = L.detect_result_hero(load(name_path('r_028')), bank)
    rec('e5', 'result-hero(r_028 非MVP)', 'confident=False',
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
    print('=' * 78)
    print('  测试小鱼 · 识别函数验证  %s' % time.strftime('%Y-%m-%d %H:%M:%S'))
    try:  # 记录被测代码版本，便于复现
        import subprocess
        head = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'],
                              capture_output=True, text=True, timeout=10).stdout.strip()
        print('  被测代码版本: %s' % (head or 'unknown'))
    except Exception:
        print('  被测代码版本: unknown')
    print('=' * 78)

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

    total = len(RECORDS)
    passed = sum(1 for r in RECORDS if r['pass'])
    print('\n' + '=' * 78)
    print('  小计: %d 项 / 通过 %d / 失败 %d' % (total, passed, total - passed))
    for r in RECORDS:
        if not r['pass']:
            print('    [FAIL] %s %s: expect=%s actual=%s' % (
                r['case'], r['item'], r['expected'], r['actual']))
    print('=' * 78)
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
