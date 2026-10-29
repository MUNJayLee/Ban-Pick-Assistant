# -*- coding: utf-8 -*-
"""测试小鱼 · 边界/健壮性测试（识别函数层，不需要 API 服务）

覆盖：
  1. 文件读取：不存在 / 损坏（非图片字节）/ 空文件（0 字节）
  2. normalize：标准分辨率 / 非 16:9 / 超小图 / 0x0 异常
  3. crop_avatar：四角 / 超大半径 / 超小半径 / 越界
  4. is_lane_icon：None / 全黑 / 噪声 / 真实英雄头像 / 真实分路图标
  5. recognize_bans / recognize_picks：全黑帧 / 噪声帧 / 超小图放大 / None 输入
  6. detect_bp / detect_phase_fast：全黑 / 噪声 / 真机帧
  7. 可选 --ocr：detect_phase OCR 边界（慢，默认跳过）

设计原则：
  - 「合法但极端」的输入要求安全返回（空列表 / False / 明确异常类型）；
  - 进程绝不能崩溃；异常必须是可捕获的 Python/CV 异常；
  - 发现的行为若与期望不符，标记 KI（已知问题，不计失败）。

跑法：
  python scripts/_test_boundary.py          # 全量（约 5~10s）
  python scripts/_test_boundary.py --ocr    # 加跑 OCR 阶段识别（+10~20s）
输出：_diag/test_boundary.json
退出码：0 = 无意外失败；1 = 有意外失败
"""
import argparse
import glob
import json
import os
import sys
import tempfile
import time
import traceback

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import recognize_screenshot as R  # noqa: E402
import live_recognize as L  # noqa: E402

OUT_JSON = '_diag/test_boundary.json'
DIAG = os.path.join(ROOT, '_diag')
RECORDS = []
T0 = time.time()

KNOWN_ISSUES = {}   # 当前无已知问题；保留结构方便后续标记


def rec(case, item, expected, actual, ok, note='', ki=None, ms=None):
    if ok:
        verdict = 'XPASS' if ki else 'PASS'
    else:
        verdict = 'XFAIL' if ki else 'FAIL'
    r = {'case': case, 'item': item, 'expected': expected, 'actual': actual,
         'pass': bool(ok), 'verdict': verdict, 'known_issue': ki, 'note': note, 'ms': ms}
    RECORDS.append(r)
    print('[%s] %-5s %-40s expect=%-28s actual=%s %s%s%s' % (
        verdict, case, item, expected, actual, note,
        (' [%s]' % ki) if ki else '',
        (' %.0fms' % ms) if ms is not None else ''))
    return r


def timed(fn, *a, **kw):
    t = time.time()
    try:
        v = fn(*a, **kw)
        return v, (time.time() - t) * 1000, None
    except Exception as e:
        return None, (time.time() - t) * 1000, e


def expect_exception(case, item, fn, types, note=''):
    """断言调用抛出指定类型异常（可捕获、非进程崩溃）。"""
    v, ms, e = timed(fn)
    ok = isinstance(e, types)
    rec(case, item, '抛出 %s' % '/'.join(t.__name__ for t in types),
        ('OK %r' % (v,)) if e is None else '%s: %s' % (type(e).__name__, str(e)[:80]),
        ok, note or '允许明确异常，但不允许进程崩溃', ms=round(ms, 1))


def frame(name):
    path = os.path.join(DIAG, name)
    raw = R.imread_unicode(path)
    return L.normalize(raw) if raw is not None else None


# ---------------------------------------------------------------------------
# 1) 文件读取边界
# ---------------------------------------------------------------------------
def test_io(tmpdir):
    print('\n=== 1) 文件读取边界 ===')
    missing = os.path.join(tmpdir, 'not_exist.png')
    expect_exception('io', 'imread_unicode(不存在文件)', lambda: R.imread_unicode(missing),
                     (FileNotFoundError,), '明确的文件不存在异常')

    corrupt = os.path.join(tmpdir, 'corrupt.png')
    with open(corrupt, 'wb') as f:
        f.write(b'not an image at all')
    v, ms, e = timed(R.imread_unicode, corrupt)
    rec('io', 'imread_unicode(损坏图片)', '返回 None（安全检查点）',
        'None' if v is None else repr(v), v is None and e is None,
        '损坏内容不应返回半解码图像', ms=round(ms, 1))

    empty = os.path.join(tmpdir, 'empty.png')
    with open(empty, 'wb') as f:
        f.write(b'')
    expect_exception('io', 'imread_unicode(空文件 0 字节)', lambda: R.imread_unicode(empty),
                     (cv2.error, ValueError, OSError),
                     '空文件由 OpenCV 抛错（调用方需 try/except）；API 侧见 KI-7')

    # 真实 PNG 可正常读取
    frames = glob.glob(os.path.join(DIAG, 'live_*.png'))
    if frames:
        v, ms, e = timed(R.imread_unicode, frames[0])
        rec('io', 'imread_unicode(真实帧)', 'ndarray HxWx3',
            '%s %s' % (getattr(v, 'shape', None), type(e).__name__ if e else ''),
            v is not None and v.ndim == 3, '', ms=round(ms, 1))


# ---------------------------------------------------------------------------
# 2) normalize 边界
# ---------------------------------------------------------------------------
def test_normalize():
    print('\n=== 2) normalize 边界 ===')
    cases = [
        ('1920x864 基准', (864, 1920, 3), (864, 1920)),
        ('1280x576（真机小图）', (576, 1280, 3), (864, 1920)),
        ('2772x1280（超宽真机）', (1280, 2772, 3), (887, 1920)),
        ('1000x1000 正方形', (1000, 1000, 3), (1920, 1920)),
        ('8x8 超小图', (8, 8, 3), (1920, 1920)),
    ]
    for tag, shape, want in cases:
        img = np.zeros(shape, np.uint8)
        v, ms, e = timed(L.normalize, img)
        got = v.shape[:2] if v is not None else None
        rec('normalize', tag, '输出宽=1920 且高=%d' % want[0],
            '%s %s' % (got, type(e).__name__ if e else ''),
            v is not None and got == want, '', ms=round(ms, 1))

    # 0x0 图像：明确异常即可（不允许进程崩溃）
    expect_exception('normalize', '0x0 空图像', lambda: L.normalize(np.zeros((0, 0, 3), np.uint8)),
                     (ZeroDivisionError, ValueError, cv2.error),
                     '空图像会除零；生产入口由 imdecode 返回 None 兜底')


# ---------------------------------------------------------------------------
# 3) crop_avatar 边界
# ---------------------------------------------------------------------------
def test_crop_avatar():
    print('\n=== 3) crop_avatar 边界 ===')
    img = np.zeros((864, 1920, 3), np.uint8)
    cv2.rectangle(img, (100, 30), (140, 70), (200, 200, 200), -1)
    cases = [
        ('左上角 (0,0,r=5)', (0, 0, 5), '96x96'),
        ('右下角越界', (1919, 863, 20), '96x96'),
        ('半径 1', (100, 50, 1), '96x96'),
        ('超大半径 5000', (960, 432, 5000), '96x96'),
        ('完全出界 (5000,5000)', (5000, 5000, 20), '96x96'),
    ]
    for tag, args, want in cases:
        v, ms, e = timed(L.crop_avatar, img, *args)
        got = '%sx%s' % (v.shape[1], v.shape[0]) if v is not None else None
        rec('crop_avatar', tag, want, got if e is None else '%s: %s' % (type(e).__name__, e),
            v is not None and got == want, '', ms=round(ms, 1))


# ---------------------------------------------------------------------------
# 4) is_lane_icon 边界
# ---------------------------------------------------------------------------
def test_is_lane_icon():
    print('\n=== 4) is_lane_icon 边界 ===')
    v, ms, e = timed(L.is_lane_icon, None)
    rec('is_lane_icon', 'None 输入', 'False（安全默认）',
        '%r %s' % (v, type(e).__name__ if e else ''), v is False and e is None,
        '', ms=round(ms, 1))

    black = np.zeros((96, 96, 3), np.uint8)
    v, ms, e = timed(L.is_lane_icon, black)
    rec('is_lane_icon', '全黑图', 'False',
        '%r %s' % (v, type(e).__name__ if e else ''), v is False, '', ms=round(ms, 1))

    noise = (np.random.rand(96, 96, 3) * 255).astype(np.uint8)
    v, ms, e = timed(L.is_lane_icon, noise)
    rec('is_lane_icon', '随机噪声', 'bool（不崩溃）',
        '%r %s' % (v, type(e).__name__ if e else ''), isinstance(v, bool), '',
        ms=round(ms, 1))

    # 真实英雄头像（元流之子·辅助，pick_235855 B1）：不应判为分路图标
    img = frame('live_pick_235855.png')
    if img is not None:
        H, W = img.shape[:2]
        r = max(8, int(round(W * 0.0234)))
        cy = int(round(H * (0.1713 + 0.1620 * 0)))
        crop = L.crop_avatar(img, int(round(W * 0.0859)), cy, r)
        v, ms, e = timed(L.is_lane_icon, crop)
        rec('is_lane_icon', '真实英雄头像（元流之子·辅助）', 'False',
            '%r' % (v,), v is False, '英雄头像不得被误判为分路图标', ms=round(ms, 1))

    # 真实分路图标（selecting_234229 blue3 = 对抗路图标）：应判为 True
    img = frame('live_selecting_234229.png')
    if img is not None:
        H, W = img.shape[:2]
        r = max(8, int(round(W * 0.0234)))
        cy = int(round(H * (0.1713 + 0.1620 * 2)))
        crop = L.crop_avatar(img, int(round(W * 0.0859)), cy, r)
        v, ms, e = timed(L.is_lane_icon, crop)
        rec('is_lane_icon', '真实对抗路图标（用户标注）', 'True',
            '%r' % (v,), v is True, 'pick 位的分路图标应与 ban 位模板同机制检出',
            ms=round(ms, 1))


# ---------------------------------------------------------------------------
# 5) recognize_bans / recognize_picks 边界
# ---------------------------------------------------------------------------
BAN_KEYS = {'side', 'index', 'hero_id', 'name', 'score', 'gap', 'confident'}
PICK_KEYS = {'side', 'index', 'hero_id', 'name', 'score', 'gap', 'confident', 'empty'}


def check_entries(case, tag, entries, keys):
    ok = isinstance(entries, list) and all(keys <= set(e) for e in entries)
    sides_ok = all(e.get('side') in ('blue', 'red') for e in entries)
    idx_ok = all(1 <= e.get('index', 0) <= 5 for e in entries)
    return rec(case, tag, 'list[dict] 且字段/取值范围合法',
               'len=%s 字段/取值=%s' % (len(entries) if isinstance(entries, list) else 'N/A',
                                        'OK' if ok and sides_ok and idx_ok else 'BAD'),
               ok and sides_ok and idx_ok)


def test_recognize(bank):
    print('\n=== 5) recognize_bans / recognize_picks 边界 ===')
    black = np.zeros((864, 1920, 3), np.uint8)
    # 柔和噪声（高斯模糊后的随机画面）：模拟「不含 BP 结构的画面」，
    # 又不会让 Hough 在病态高频噪声上耗 40s（真实截图不会长这样）。
    rng = np.random.RandomState(42)
    noise = cv2.GaussianBlur((rng.rand(864, 1920, 3) * 255).astype(np.uint8), (11, 11), 0)

    v, ms, e = timed(L.recognize_bans, black, bank)
    rec('recognize_bans', '全黑帧', '[]（无 ban）',
        '%r %s' % (v, type(e).__name__ if e else ''), v == [] and e is None,
        '', ms=round(ms, 1))

    v, ms, e = timed(L.recognize_bans, noise, bank)
    ok = check_entries('recognize_bans', '非 BP 噪声帧', v, BAN_KEYS)
    if ok:
        rec('recognize_bans', '非 BP 噪声帧耗时（记录项）', '仅记录，不作性能判定',
            '%.0fms len=%d' % (ms, len(v or [])), True,
            '真实帧性能基准见 _test_benchmark.py', ms=round(ms, 1))

    v, ms, e = timed(L.recognize_bans, None, bank)
    rec('recognize_bans', 'None 输入', '明确异常（调用方需预判空）',
        '%s %s' % (v, type(e).__name__ if e else ''), isinstance(e, AttributeError),
        'None 会 AttributeError；生产入口不会传入 None', ms=round(ms, 1))

    v, ms, e = timed(L.recognize_picks, black, bank)
    empties = [p for p in (v or []) if p.get('empty')]
    rec('recognize_picks', '全黑帧', '10 项且全 empty',
        'len=%s empty=%s %s' % (len(v or []), len(empties),
                                type(e).__name__ if e else ''),
        v is not None and len(v) == 10 and len(empties) == 10, '', ms=round(ms, 1))

    v, ms, e = timed(L.recognize_picks, noise, bank)
    ok = check_entries('recognize_picks', '非 BP 噪声帧', v, PICK_KEYS)
    if ok:
        rec('recognize_picks', '非 BP 噪声帧耗时（记录项）', '仅记录，不作性能判定',
            '%.0fms' % ms, True, '真实帧性能基准见 _test_benchmark.py', ms=round(ms, 1))

    v, ms, e = timed(L.recognize_picks, None, bank)
    rec('recognize_picks', 'None 输入', '明确异常（调用方需预判空）',
        '%s %s' % (v, type(e).__name__ if e else ''), isinstance(e, AttributeError),
        '', ms=round(ms, 1))

    # 超小图放大后仍能安全识别
    tiny = L.normalize(np.zeros((8, 8, 3), np.uint8))
    v, ms, e = timed(L.recognize_bans, tiny, bank)
    rec('recognize_bans', '8x8 放大帧', 'list（不崩溃）',
        'len=%s %s' % (len(v or []), type(e).__name__ if e else ''),
        isinstance(v, list) and e is None, '', ms=round(ms, 1))


# ---------------------------------------------------------------------------
# 6) detect_bp / detect_phase_fast 边界
# ---------------------------------------------------------------------------
def test_detect():
    print('\n=== 6) detect_bp / detect_phase_fast 边界 ===')
    black = np.zeros((864, 1920, 3), np.uint8)
    noise = (np.random.RandomState(7).rand(864, 1920, 3) * 255).astype(np.uint8)

    v, ms, e = timed(L.detect_bp, black)
    rec('detect_bp', '全黑帧', 'is_bp=False, count=0',
        '%s' % ({k: v.get(k) for k in ('is_bp', 'count', 'locks')} if v else e),
        v is not None and v.get('is_bp') is False and v.get('count') == 0,
        '', ms=round(ms, 1))

    v, ms, e = timed(L.detect_bp, noise)
    rec('detect_bp', '随机噪声帧', '返回 dict 且 is_bp 为 bool（不崩溃）',
        'is_bp=%s count=%s' % (v.get('is_bp') if v else e, v.get('count') if v else ''),
        isinstance(v, dict) and isinstance(v.get('is_bp'), bool), '', ms=round(ms, 1))

    v, ms, e = timed(L.detect_phase_fast, black)
    rec('detect_phase_fast', '全黑帧', "('unknown', False)",
        '%r' % (v,), v == ('unknown', False), '', ms=round(ms, 1))

    # 真机 ban 帧：布局检测应给出非 unknown
    img = frame('live_ban_234153.png')
    if img is not None:
        v, ms, e = timed(L.detect_phase_fast, img)
        rec('detect_phase_fast', '真机 ban 帧', '非 unknown 且 confident=True',
            '%r' % (v,), v is not None and v[0] != 'unknown' and v[1] is True,
            '', ms=round(ms, 1))

    img = frame('live_other_001605.png')
    if img is not None:
        v, ms, e = timed(L.detect_bp, img)
        rec('detect_bp', '真机游戏内帧（非 BP）', 'is_bp=False',
            'is_bp=%s count=%s top_v=%s' % (
                v.get('is_bp') if v else e, v.get('count') if v else '',
                v.get('top_v') if v else ''),
            v is not None and v.get('is_bp') is False, '', ms=round(ms, 1))


# ---------------------------------------------------------------------------
# 7) OCR 阶段识别边界（可选，慢）
# ---------------------------------------------------------------------------
def test_phase_ocr():
    print('\n=== 7) detect_phase OCR（--ocr，较慢）===')
    cases = [
        ('live_other_001605.png', 'other', '游戏内画面'),
        ('live_ban_234153.png', 'ban', '禁英雄阶段'),
        ('live_pick_235855.png', 'final', '最后调整'),
    ]
    for name, want, note in cases:
        img = frame(name)
        if img is None:
            continue
        L._PHASE_CACHE['sig'] = None
        v, ms, e = timed(L.detect_phase, img)
        rec('detect_phase', name, "phase='%s'" % want,
            '%r %s' % (v, type(e).__name__ if e else ''),
            v is not None and v[0] == want, note, ms=round(ms, 1))


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description='识别函数边界/健壮性测试')
    ap.add_argument('--ocr', action='store_true', help='额外跑 OCR 阶段识别（慢）')
    args = ap.parse_args()

    print('=' * 84)
    print('  测试小鱼 · 边界/健壮性测试   %s' % time.strftime('%Y-%m-%d %H:%M:%S'))
    print('=' * 84)
    tmpdir = tempfile.mkdtemp(prefix='bp_boundary_')
    try:
        test_io(tmpdir)
        test_normalize()
        test_crop_avatar()
        test_is_lane_icon()
        print('\n  加载 FeatureBank（约 1s）...')
        t = time.time()
        bank = L.FeatureBank()
        print('  FeatureBank %.0fms' % ((time.time() - t) * 1000))
        test_recognize(bank)
        test_detect()
        if args.ocr:
            test_phase_ocr()
    except Exception:
        traceback.print_exc()
        rec('internal', '未捕获异常', '无', '见 traceback', False)
    finally:
        try:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass

    total = len(RECORDS)
    passed = sum(1 for r in RECORDS if r['verdict'] in ('PASS', 'XPASS'))
    fails = [r for r in RECORDS if r['verdict'] == 'FAIL']
    xfails = [r for r in RECORDS if r['verdict'] == 'XFAIL']
    xpasses = [r for r in RECORDS if r['verdict'] == 'XPASS']
    print('\n' + '=' * 84)
    print('  小计: %d 项 / PASS %d / FAIL %d / XFAIL(已知问题) %d / XPASS %d   （%.1fs）'
          % (total, passed, len(fails), len(xfails), len(xpasses), time.time() - T0))
    for r in xfails:
        print('    [XFAIL %s] %s: expect=%s actual=%s' % (
            r['known_issue'], r['item'], r['expected'], r['actual']))
    for r in xpasses:
        print('    [XPASS] %s：已知问题已修复' % r['item'])
    for r in fails:
        print('    [FAIL] %s %s: expect=%s actual=%s' % (
            r['case'], r['item'], r['expected'], r['actual']))
    print('=' * 84)

    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump({'generated': time.strftime('%Y-%m-%d %H:%M:%S'),
                   'total': total, 'passed': passed, 'failed': len(fails),
                   'xfail': len(xfails), 'xpass': len(xpasses),
                   'known_issues': KNOWN_ISSUES, 'records': RECORDS},
                  f, ensure_ascii=False, indent=1)
    print('明细已写入 %s' % OUT_JSON)
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
