# -*- coding: utf-8 -*-
"""真机帧回归测试 + 用户核对金标准断言。

数据来源
--------
- `_diag/review.json`：用户在「核对页」人工核对的 42 条标注（2026-10-29），
  每条含 frame / kind / side / index / correct / note。
  备注里给出了三类信息：
    * 正确英雄名（如「赵云」「元流之子坦克」「钟馗」「不知火舞」「孙尚香」）
    * 未选择/分路图标（如「未选择，实则是对抗路标志」）
    * 裁切质量（如「裁切框偏右」）
- 测试小鱼看图补充的判定：核对页中「用户标✗但无备注」的位置，
  人工确认裁切内容是分路图标/段位徽章（未选择），不是英雄。

断言分类
--------
1. HERO_GOLD    ：该位置识别出的 hero_id 必须 == 期望值
                  （correct=true 的冻结基线 + 用户备注指出的正确英雄）
2. NON_HERO_GOLD：该位置是「未选择」的分路图标/段位徽章，不能当成英雄
                  （判定：empty 或 is_lane_icon() 命中）
3. BAN_ROW_FILTER：`recognize_bans(skip_lane_icons=True)` 不得过滤真实 ban
                  （回归守卫：2026-10-29 曾因模板取错坐标误删真实 ban，已修复）
4. CROP_GEOMETRY：用户备注「裁切框偏右」的 ban B5 位，裁切中心应与
                  B1~B4 等距外推值一致（≤ 4px；修复前约 7px）
5. NON_BP_FRAME ：非 BP 阶段帧（游戏内）不能按 BP 帧识别英雄
                  （用户在该帧标了 6 处✗，属「识别结果不适用」）

已知问题（KI）不阻塞 CI：断言失败但标记 KI 记为 XFAIL（退出码仍为 0），
修复后会显示 XPASS。真正的回归（无 KI 的失败）退出码 1。
当前仅剩 KI-2（用户纠正的 6 个英雄名/变体识别错误）。
2026-10-29 晚已修复并转为回归守卫：KI-1（分路图标）、KI-4（ban 行误删）、
KI-5（裁切偏右）。

用法
----
  python scripts/_test_real_frames.py            # 金标准断言（默认，约 10s）
  python scripts/_test_real_frames.py --scan     # 全量 150 帧识别明细（慢，写 test_real_frames.json）
  python scripts/_test_real_frames.py --scan --limit 20 --ban|--final
  python scripts/_test_real_frames.py --gold     # 显式金标准模式（同默认）

输出
----
  控制台摘要 + `_diag/test_real_frames_gold.json`（金标准结果）
  扫描模式另写 `_diag/test_real_frames.json`（全量识别明细）
"""
import argparse
import glob
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

import recognize_screenshot as R  # noqa: E402
import live_recognize as L  # noqa: E402

DIAG_DIR = os.path.join(ROOT, '_diag')
REVIEW_PATH = os.path.join(DIAG_DIR, 'review.json')
GOLD_JSON = os.path.join(DIAG_DIR, 'test_real_frames_gold.json')
SCAN_JSON = os.path.join(DIAG_DIR, 'test_real_frames.json')

# ---------------------------------------------------------------------------
# 已知问题（失败时不算回归，修复后显示 XPASS）
# ---------------------------------------------------------------------------
KNOWN_ISSUES = {
    'KI-2': '英雄变体/英雄名误识别（用户已给出正确英雄，识别器尚未修）',
}

# ---------------------------------------------------------------------------
# 1) 英雄识别金标准
#    格式: key -> (期望 hero_id, 已知问题, 依据)
#    key = frame|kind|side|index
# ---------------------------------------------------------------------------
_KI_NONE = None
HERO_GOLD = {
    # ---- ban 帧：用户核对 correct=true 的冻结基线 ----
    'live_ban_234142.png|ban|blue|5': ('wangwei', _KI_NONE, '用户核对正确（备注裁切偏右，识别本身正确）'),
    'live_ban_234153.png|ban|blue|2': ('zhuangzhou', _KI_NONE, '用户核对正确'),
    'live_ban_234153.png|ban|blue|5': ('wangwei', _KI_NONE, '用户核对正确（备注裁切偏右）'),
    'live_ban_234154.png|ban|blue|2': ('zhuangzhou', _KI_NONE, '用户核对正确'),
    'live_ban_234154.png|ban|blue|3': ('dunshan', _KI_NONE, '用户核对正确（盾山）'),
    'live_ban_234154.png|ban|blue|5': ('wangwei', _KI_NONE, '用户核对正确（备注裁切偏右）'),
    'live_ban_235654.png|ban|blue|2': ('zhuangzhou', _KI_NONE, '用户核对正确'),
    'live_ban_235708.png|ban|blue|2': ('zhuangzhou', _KI_NONE, '用户核对正确'),
    # ---- pick 帧：用户逐位核对 correct=true（10/10）----
    'live_pick_235855.png|pick|blue|1': ('yuanliuzhizi_support', _KI_NONE, '用户核对正确'),
    'live_pick_235855.png|pick|blue|2': ('daqiao', _KI_NONE, '用户核对正确'),
    'live_pick_235855.png|pick|blue|3': ('xiangyu', _KI_NONE, '用户核对正确'),
    'live_pick_235855.png|pick|blue|4': ('gongbenwucang', _KI_NONE, '用户核对正确'),
    'live_pick_235855.png|pick|blue|5': ('direnjie', _KI_NONE, '用户核对正确'),
    'live_pick_235855.png|pick|red|1': ('makeboluo', _KI_NONE, '用户核对正确'),
    'live_pick_235855.png|pick|red|2': ('duoliya', _KI_NONE, '用户核对正确'),
    'live_pick_235855.png|pick|red|3': ('hainuo', _KI_NONE, '用户核对正确'),
    'live_pick_235855.png|pick|red|4': ('yunyao', _KI_NONE, '用户核对正确'),
    'live_pick_235855.png|pick|red|5': ('yangjian', _KI_NONE, '用户核对正确'),
    # ---- selecting 帧：用户核对 correct=true ----
    'live_selecting_234213.png|pick|red|1': ('zhaoyun', _KI_NONE, '用户核对正确（赵云）'),
    'live_selecting_234222.png|pick|red|1': ('zhaoyun', _KI_NONE, '用户核对正确（赵云）'),
    'live_selecting_234229.png|pick|blue|2': ('zhongkui', _KI_NONE, '用户核对正确（钟馗）'),
    'live_selecting_234229.png|pick|red|1': ('zhaoyun', _KI_NONE, '用户核对正确（赵云）'),
    # ---- 用户标✗并备注了正确英雄：识别器当前未修（KI-2）----
    'live_selecting_234205.png|pick|red|1': ('zhaoyun', 'KI-2', '用户备注「赵云」，当前识别为东皇太一'),
    'live_selecting_234222.png|pick|blue|1': ('yuanliuzhizi_tank', 'KI-2', '用户备注「元流之子坦克」，当前识别为百里守约'),
    'live_selecting_234222.png|pick|blue|2': ('zhongkui', 'KI-2', '用户备注「钟馗」，当前识别为云中君'),
    'live_selecting_234229.png|pick|blue|1': ('yuanliuzhizi_tank', 'KI-2', '用户备注「元坦」，当前识别为元流之子(法师)（变体错）'),
    'live_selecting_234229.png|pick|red|2': ('buzhihuowu', 'KI-2', '用户备注「不知火舞」，当前识别为兰陵王'),
    'live_selecting_234229.png|pick|red|3': ('sunshangxiang', 'KI-2', '用户备注「孙尚香」，当前识别为王维'),
}

# ---------------------------------------------------------------------------
# 2) 「未选择」金标准：分路图标 / 段位徽章，不能当成英雄
#    格式: key -> (已知问题, 依据)
# ---------------------------------------------------------------------------
NOT_HERO_GOLD = {
    # 用户备注「未选择，实则是…标志」的 3 位（核对页 kind=pick → 左侧队伍列表）
    'live_selecting_234229.png|pick|blue|3': (None, '用户备注：未选择，实则是对抗路标志'),
    'live_selecting_234229.png|pick|blue|4': (None, '用户备注：未选择，实则是中路标志'),
    'live_selecting_234229.png|pick|blue|5': (None, '用户备注：未选择，实则是发育路标志（裁切实际是段位徽章，均为未选择）'),
    # 用户标✗但无备注；测试小鱼看图确认这 5 位全是分路图标/段位徽章
    'live_selecting_234213.png|pick|blue|1': (None, '用户标✗ + 看图：分路图标（翼形），非英雄'),
    'live_selecting_234213.png|pick|blue|2': (None, '用户标✗ + 看图：分路图标（翼形），非英雄'),
    'live_selecting_234213.png|pick|blue|3': (None, '用户标✗ + 看图：对抗路图标，非英雄'),
    'live_selecting_234213.png|pick|blue|4': (None, '用户标✗ + 看图：中路图标，非英雄'),
    'live_selecting_234213.png|pick|blue|5': (None, '用户标✗ + 看图：段位徽章（未选择），非英雄'),
}

# ---------------------------------------------------------------------------
# 3) ban 行分路图标过滤：真实 ban 不能被误删（回归守卫，2026-10-29 曾误删）
# ---------------------------------------------------------------------------
BAN_ROW_FILTER_FRAMES = [
    'live_ban_234153.png',       # ban 阶段：B2 庄周 / B3 盾山 / B5 王维
    'live_selecting_234229.png',  # 选人阶段：顶部 10 个真实 ban
    'live_pick_235855.png',      # final 帧：顶部 10 个真实 ban
]

# ---------------------------------------------------------------------------
# 4) 裁切几何：用户备注「裁切框偏右」的帧（ban B5，回归守卫）
#    历史上 B5 Hough 半径偏小(20 vs 24) + 圆心偏右 ~7px；修复后残余 3~3.5px。
# ---------------------------------------------------------------------------
CROP_GEOMETRY_FRAMES = [
    ('live_ban_234142.png', '用户备注裁切框偏右；修复后残余 ~3px'),
    ('live_ban_234153.png', '用户备注裁切框偏右；修复后残余 ~3.5px'),
    ('live_ban_234154.png', '用户备注裁切框偏右；修复后残余 ~3.5px'),
]
CROP_CENTER_TOL = 4.0      # px（修复前约 7px，容差 4px 防回归；Hough 自身有 ±2px 噪声）

# ---------------------------------------------------------------------------
# 5) 非 BP 帧：review 标注不适用
# ---------------------------------------------------------------------------
NON_BP_FRAMES = {
    'live_other_001605.png': {
        'marks': 6,
        'note': '游戏内画面（非 BP），用户标 6 处✗ → 识别结果不适用，'
                '要求 detect_bp() 判非 BP（管线不会消费该帧的 pick）',
    },
}

# ---------------------------------------------------------------------------
# 记录
# ---------------------------------------------------------------------------
RECORDS = []


def record(case, frame, pos, expected, actual, ok, ki=None, note=''):
    if ok:
        verdict = 'XPASS' if ki else 'PASS'
    else:
        verdict = 'XFAIL' if ki else 'FAIL'
    r = {'case': case, 'frame': frame, 'pos': pos, 'expected': expected,
         'actual': actual, 'pass': bool(ok), 'verdict': verdict,
         'known_issue': ki, 'note': note}
    RECORDS.append(r)
    tag = {'PASS': 'PASS ', 'FAIL': 'FAIL ', 'XFAIL': 'XFAIL', 'XPASS': 'XPASS'}[verdict]
    suffix = ''
    if ki:
        suffix = ' [%s] %s' % (ki, KNOWN_ISSUES.get(ki, ''))
    print('[%s] %-42s %-12s expect=%-22s actual=%-40s %s%s' % (
        tag, '%s %s' % (frame, pos), case, expected, actual, note, suffix))
    return r


# ---------------------------------------------------------------------------
# 帧缓存 / 识别缓存
# ---------------------------------------------------------------------------
class FrameCache:
    def __init__(self, bank):
        self.bank = bank
        self._imgs = {}
        self._bans = {}
        self._picks = {}

    def img(self, frame):
        if frame not in self._imgs:
            path = os.path.join(DIAG_DIR, frame)
            if not os.path.isfile(path):
                self._imgs[frame] = None
            else:
                raw = R.imread_unicode(path)
                self._imgs[frame] = L.normalize(raw) if raw is not None else None
        return self._imgs[frame]

    def bans(self, frame):
        if frame not in self._bans:
            n = self.img(frame)
            if n is None:
                self._bans[frame] = []
            else:
                try:
                    self._bans[frame] = L.recognize_bans(n, self.bank)
                except Exception as e:
                    self._bans[frame] = []
                    record('internal', frame, '-', 'bans 可识别', 'EXC %s' % e, False)
        return self._bans[frame]

    def picks(self, frame):
        if frame not in self._picks:
            n = self.img(frame)
            if n is None:
                self._picks[frame] = []
            else:
                try:
                    self._picks[frame] = L.recognize_picks(n, self.bank)
                except Exception as e:
                    self._picks[frame] = []
                    record('internal', frame, '-', 'picks 可识别', 'EXC %s' % e, False)
        return self._picks[frame]

    def find(self, key):
        frame, kind, side, index = key.split('|')
        index = int(index)
        source = self.bans(frame) if kind == 'ban' else self.picks(frame)
        return next((x for x in source if x['side'] == side and x['index'] == index), None)


def pick_crop(img, side, index):
    """与 api_server._slot_positions(kind='pick') 一致的裁切。"""
    H, W = img.shape[:2]
    r = max(8, int(round(W * 0.0234)))
    cy = int(round(H * (0.1713 + 0.1620 * (index - 1))))
    x_ratio = 0.0859 if side == 'blue' else 1.0 - 0.0859
    return L.crop_avatar(img, int(round(W * x_ratio)), cy, r)


def load_review_marks():
    if not os.path.isfile(REVIEW_PATH):
        return None
    with open(REVIEW_PATH, encoding='utf-8') as f:
        data = json.load(f)
    return data.get('marks') or {}


# ---------------------------------------------------------------------------
# 金标准 1：英雄识别
# ---------------------------------------------------------------------------
def test_hero_gold(fc):
    print('\n=== 1) 英雄识别金标准（用户核对 42 条中 %d 条）===' % len(HERO_GOLD))
    for key in sorted(HERO_GOLD):
        hero_id, ki, source = HERO_GOLD[key]
        frame, kind, side, index = key.split('|')
        expected = hero_id
        hit = fc.find(key)
        if hit is None:
            actual = '（未识别/空位）'
            ok = False
        else:
            actual = hit['hero_id']
            ok = actual == hero_id
        record('hero_gold', frame, '%s %s%d' % (kind, side[0].upper(), int(index)),
               expected, actual, ok, ki, source)


# ---------------------------------------------------------------------------
# 金标准 2：未选择（分路图标/段位徽章）不能当英雄
# ---------------------------------------------------------------------------
def test_non_hero_gold(fc):
    print('\n=== 2) 「未选择」金标准：分路图标/段位徽章不能当英雄（%d 条）==='
          % len(NOT_HERO_GOLD))
    for key in sorted(NOT_HERO_GOLD):
        ki, source = NOT_HERO_GOLD[key]
        frame, kind, side, index = key.split('|')
        img = fc.img(frame)
        if img is None:
            record('non_hero_gold', frame, '%s %s%s' % (kind, side[0].upper(), index),
                   '无（帧缺失）', '帧不存在', False, ki, source)
            continue
        hit = fc.find(key)
        crop = pick_crop(img, side, int(index))
        lane = bool(L.is_lane_icon(crop)) if crop is not None else False
        empty = bool(hit and hit.get('empty'))
        ok = hit is None or empty or lane
        actual = 'hero=%s(conf=%s) empty=%s lane_icon=%s' % (
            hit['hero_id'] if hit else None,
            hit.get('confident') if hit else None, empty, lane)
        record('non_hero_gold', frame, '%s %s%s' % (kind, side[0].upper(), index),
               '未选择（empty 或 lane_icon）', actual, ok, ki, source)


# ---------------------------------------------------------------------------
# 金标准 3：ban 行过滤不能误删真实 ban
# ---------------------------------------------------------------------------
def test_ban_row_filter(fc):
    print('\n=== 3) ban 行分路图标过滤：真实 ban 不得被误删（回归守卫）===')
    for frame in BAN_ROW_FILTER_FRAMES:
        img = fc.img(frame)
        if img is None:
            record('ban_row_filter', frame, '-', '帧存在', '帧不存在', False)
            continue
        plain = L.recognize_bans(img, fc.bank)
        filtered = L.recognize_bans(img, fc.bank, skip_lane_icons=True)
        keys_plain = {(b['side'], b['index']) for b in plain}
        keys_filtered = {(b['side'], b['index']) for b in filtered}
        removed = sorted(keys_plain - keys_filtered)
        ok = keys_plain == keys_filtered
        actual = 'plain=%d filtered=%d removed=%s' % (
            len(plain), len(filtered), removed or '无')
        record('ban_row_filter', frame, 'ban 行', '过滤前后一致', actual, ok,
               None, '顶部 ban 行显示的是真实 ban，不应有分路图标；'
                     '2026-10-29 旧模板曾误删真实 ban（已修复，此用例防回归）')


# ---------------------------------------------------------------------------
# 金标准 4：裁切几何（用户备注裁切框偏右）
# ---------------------------------------------------------------------------
def _ban_positions_for_review(img):
    """复刻 api_server._slot_positions(img, 'ban')，用于核对裁切中心。"""
    try:
        import api_server as A
        return A._slot_positions(img, 'ban'), 'api_server'
    except Exception:
        # 独立兜底：与 api_server 的实现保持一致
        H, W = img.shape[:2]
        out = []
        try:
            left, right = R.detect_circles(img)
            l2 = R.validate_row(left) if left else []
            r2 = R.validate_row(right) if right else []
            if len(l2) == 5 and len(r2) == 5:
                rs = sorted([c[2] for c in l2] + [c[2] for c in r2])
                r_med = rs[len(rs) // 2]
                out = [('blue', i + 1, cx - 2, cy, r_med) for i, (cx, cy, _) in enumerate(l2)]
                out += [('red', i + 1, cx + 2, cy, r_med) for i, (cx, cy, _) in enumerate(r2)]
                return out, 'fallback'
        except Exception:
            pass
        r = max(8, int(round(W * L.BAN_R_RATIO)))
        cy = int(round(H * L.BAN_Y_RATIO))
        for side, ratios in (('blue', L.BAN_X_RATIOS),
                             ('red', [1.0 - x for x in L.BAN_X_RATIOS])):
            for i, xr in enumerate(ratios, 1):
                out.append((side, i, W * xr, cy, r))
        return out, 'fallback'


def test_crop_geometry(fc):
    print('\n=== 4) 裁切几何：用户备注「裁切框偏右」的 B5 位（容差 %spx，回归守卫）==='
          % CROP_CENTER_TOL)
    for frame, source in CROP_GEOMETRY_FRAMES:
        img = fc.img(frame)
        if img is None:
            record('crop_geometry', frame, 'ban B5', '帧存在', '帧不存在', False)
            continue
        positions, mode = _ban_positions_for_review(img)
        if len(positions) < 10:
            record('crop_geometry', frame, 'ban 行', '10 个位置',
                   '%d 个（Hough=%s）' % (len(positions), mode), False)
            continue
        xs = {i: cx for side, i, cx, cy, r in positions if side == 'blue'}
        x1, x2, x3, x4, x5 = (xs[i] for i in range(1, 6))
        # B1~B4 线性外推 B5（ban 位严格等距）
        import numpy as np
        coef = np.polyfit([1, 2, 3, 4], [x1, x2, x3, x4], 1)
        predicted = float(np.polyval(coef, 5))
        dev = abs(x5 - predicted)
        ok = dev <= CROP_CENTER_TOL
        actual = 'B5=%.1f 外推=%.1f 偏差=%.2fpx' % (x5, predicted, dev)
        record('crop_geometry', frame, 'ban B5', '偏差<=%.1fpx' % CROP_CENTER_TOL,
               actual, ok, None, source)


# ---------------------------------------------------------------------------
# 金标准 5：非 BP 帧不适用
# ---------------------------------------------------------------------------
def test_non_bp_frames(fc):
    print('\n=== 5) 非 BP 帧：用户标注不适用（%d 帧）===' % len(NON_BP_FRAMES))
    for frame, spec in NON_BP_FRAMES.items():
        img = fc.img(frame)
        if img is None:
            record('non_bp_frame', frame, '-', '帧存在', '帧不存在', False)
            continue
        try:
            bp = L.detect_bp(img)
            is_bp = bool(bp.get('is_bp'))
            actual = 'is_bp=%s count=%s locks=%s top_v=%s' % (
                is_bp, bp.get('count'), bp.get('locks'), bp.get('top_v'))
        except Exception as e:
            is_bp, actual = True, 'EXC %s' % e
        ok = not is_bp
        record('non_bp_frame', frame, 'detect_bp', 'is_bp=False（游戏内画面）',
               actual, ok, None, spec['note'])
        # 用户在该帧的 6 条✗标注：归为「不适用」，不计失败
        for pos in ('blue4', 'blue5', 'red1', 'red3', 'red4', 'red5'):
            record('non_bp_frame', frame, 'pick %s' % pos,
                   '不适用（非 BP 帧）', 'SKIP（用户标✗：识别结果不应被使用）',
                   True, None, '该帧 %d 条用户标注均为「不适用」' % spec['marks'])


# ---------------------------------------------------------------------------
# 覆盖率：金标准表 ↔ review.json 双向校验
# ---------------------------------------------------------------------------
def test_gold_coverage():
    print('\n=== 0) 金标准覆盖率校验 ===')
    marks = load_review_marks()
    if marks is None:
        record('coverage', '-', '-', 'review.json 存在', '不存在（跳过覆盖率校验）',
               False, None, '用户核对数据缺失，无法校验覆盖率；请先完成核对')
        return
    all_keys = set(HERO_GOLD) | set(NOT_HERO_GOLD)
    missing_mark = sorted(k for k in all_keys if k not in marks)
    record('coverage', 'review.json', '金标准 key 均存在',
           '%d 个 key' % len(all_keys),
           '缺失 %s' % (missing_mark or '无'), not missing_mark, None,
           '金标准表引用了 review.json 里不存在的标注（数据漂移）')
    # 非 BP 帧的标注归入「不适用」，同样计入覆盖率
    non_bp_marks = {k for k in marks if k.split('|')[0] in NON_BP_FRAMES}
    covered_keys = all_keys | non_bp_marks
    uncovered = sorted(set(marks) - covered_keys)
    covered = len(covered_keys & set(marks))
    record('coverage', 'review.json', '用户标注已被金标准覆盖',
           '%d 条' % len(marks),
           'covered=%d/%d%s' % (covered, len(marks),
                                (' 未覆盖=%s' % uncovered[:5]) if uncovered else ''),
           covered >= len(marks), None,
           '未覆盖的（若用户后续新增标注）仅提示，不判失败')


# ---------------------------------------------------------------------------
# 全量扫描模式（原有功能，写 _diag/test_real_frames.json）
# ---------------------------------------------------------------------------
def frame_kind(name):
    parts = os.path.basename(name).split('_')
    return parts[1] if len(parts) >= 3 else 'unknown'


def process_frame(path, bank, slow=False):
    img = R.imread_unicode(path)
    if img is None:
        return None
    n = L.normalize(img)
    kind = frame_kind(path)
    out = {'frame': os.path.basename(path), 'kind': kind,
           'size': '%dx%d' % (n.shape[1], n.shape[0])}
    try:
        bans = L.recognize_bans(n, bank)
        out['bans'] = [{'side': b['side'], 'index': b['index'], 'hero_id': b['hero_id'],
                        'name': b['name'], 'confident': b['confident'], 'gap': b['gap']}
                       for b in bans]
        out['ban_count'] = len(bans)
        out['ban_blue'] = sum(1 for b in bans if b['side'] == 'blue')
        out['ban_red'] = sum(1 for b in bans if b['side'] == 'red')
    except Exception as e:
        out['bans'] = []
        out['ban_error'] = str(e)
    if kind in ('pick', 'selecting', 'ban'):
        if slow:
            try:
                out['is_selecting'] = L.is_selecting_screen(n)
            except Exception:
                out['is_selecting'] = None
        try:
            picks = L.recognize_picks(n, bank)
            out['picks'] = [{'side': p['side'], 'index': p['index'],
                             'hero_id': p['hero_id'], 'name': p['name'],
                             'confident': p['confident'], 'empty': p['empty']}
                            for p in picks]
            out['pick_count'] = sum(1 for p in picks if not p['empty'])
        except Exception as e:
            out['picks'] = []
            out['pick_error'] = str(e)
    return out


def run_scan(args, bank):
    frames = sorted(glob.glob(os.path.join(DIAG_DIR, 'live_*.png')),
                    key=lambda p: os.path.getmtime(p))
    if args.ban:
        frames = [f for f in frames if frame_kind(f) == 'ban']
    elif args.final:
        frames = [f for f in frames if frame_kind(f) in ('pick', 'selecting')]
    if args.limit > 0:
        frames = frames[-args.limit:]
    if not frames:
        print('没有匹配的帧')
        return
    print('扫描 %d 帧（--scan 模式，明细 -> %s）' % (len(frames), SCAN_JSON))
    results = []
    t0 = time.time()
    for i, f in enumerate(frames, 1):
        r = process_frame(f, bank, slow=args.slow)
        if r is None:
            continue
        results.append(r)
        line = '[%s] %s ban=%d' % (r['kind'], r['frame'], r.get('ban_count', 0))
        if 'pick_count' in r:
            line += ' pick=%d' % r['pick_count']
        if r.get('is_selecting'):
            line += ' [选人界面]'
        print(line)
    with open(SCAN_JSON, 'w', encoding='utf-8') as f:
        json.dump({'generated': time.strftime('%Y-%m-%d %H:%M:%S'),
                   'mode': 'scan', 'frame_count': len(results),
                   'elapsed_s': round(time.time() - t0, 1), 'results': results},
                  f, ensure_ascii=False, indent=2)
    print('共 %d 帧，耗时 %.1fs，明细: %s' % (len(results), time.time() - t0, SCAN_JSON))


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def run_gold():
    t0 = time.time()
    marks = load_review_marks()
    print('=' * 92)
    print('  真机帧金标准断言（用户核对标注 42 条）  %s'
          % time.strftime('%Y-%m-%d %H:%M:%S'))
    if marks is None:
        print('  [提示] 未找到 %s：金标准源数据缺失，仅运行内置断言表' % REVIEW_PATH)
    else:
        print('  review.json：%d 条标注' % len(marks))
    print('=' * 92)
    bank = L.FeatureBank()
    fc = FrameCache(bank)
    test_gold_coverage()
    test_hero_gold(fc)
    test_non_hero_gold(fc)
    test_ban_row_filter(fc)
    test_crop_geometry(fc)
    test_non_bp_frames(fc)

    total = len(RECORDS)
    passed = sum(1 for r in RECORDS if r['verdict'] in ('PASS', 'XPASS'))
    failed = [r for r in RECORDS if r['verdict'] == 'FAIL']
    xfail = [r for r in RECORDS if r['verdict'] == 'XFAIL']
    xpass = [r for r in RECORDS if r['verdict'] == 'XPASS']
    print('\n' + '=' * 92)
    print('  小计: %d 项 | PASS %d | FAIL %d | XFAIL(已知问题) %d | XPASS %d | 耗时 %.1fs'
          % (total, passed, len(failed), len(xfail), len(xpass), time.time() - t0))
    if xfail:
        by_ki = {}
        for r in xfail:
            by_ki.setdefault(r['known_issue'], []).append(r)
        for ki in sorted(by_ki):
            print('    [XFAIL %s] %d 项：%s' % (ki, len(by_ki[ki]), KNOWN_ISSUES.get(ki, '')))
    if xpass:
        for r in xpass:
            print('    [XPASS] %s %s %s：已知问题已修复，请同步更新金标准表'
                  % (r['frame'], r['pos'], r['known_issue']))
    for r in failed:
        print('    [FAIL] %s %s %s: expect=%s actual=%s' % (
            r['frame'], r['pos'], r['case'], r['expected'], r['actual']))
    print('=' * 92)

    with open(GOLD_JSON, 'w', encoding='utf-8') as f:
        json.dump({
            'generated': time.strftime('%Y-%m-%d %H:%M:%S'),
            'mode': 'gold',
            'review_marks': len(marks) if marks else 0,
            'known_issues': KNOWN_ISSUES,
            'total': total, 'passed': passed, 'failed': len(failed),
            'xfail': len(xfail), 'xpass': len(xpass),
            'fail_count_unexpected': len(failed),
            'records': RECORDS,
        }, f, ensure_ascii=False, indent=1)
    print('明细: %s' % GOLD_JSON)
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser(description='真机帧金标准断言 / 全量扫描')
    ap.add_argument('--scan', action='store_true', help='全量扫描模式（慢，写 test_real_frames.json）')
    ap.add_argument('--gold', action='store_true', help='金标准断言模式（默认）')
    ap.add_argument('--limit', type=int, default=0, help='扫描模式：只看最近 N 帧')
    ap.add_argument('--ban', action='store_true', help='扫描模式：只看 ban 帧')
    ap.add_argument('--final', action='store_true', help='扫描模式：只看 pick/selecting 帧')
    ap.add_argument('--slow', action='store_true', help='扫描模式：额外做 is_selecting OCR（每帧约 10s）')
    args = ap.parse_args()

    if args.scan:
        bank = L.FeatureBank()
        run_scan(args, bank)
        return 0
    return run_gold()


if __name__ == '__main__':
    sys.exit(main())
