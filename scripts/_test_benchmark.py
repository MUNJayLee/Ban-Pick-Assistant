# -*- coding: utf-8 -*-
"""测试小鱼 · 性能基准（识别冷启动 / 稳态 / API 响应时间）

写入 `_diag/benchmark.json`，同时打印可读摘要。

内容
----
1. 环境：Python / OpenCV / NumPy / CPU / 平台
2. 识别冷启动：FeatureBank 初始化、首个 recognize_bans / recognize_picks
3. 识别稳态（真实帧，重复采样）：imread / normalize / recognize_bans /
   recognize_picks / is_lane_icon / crop_avatar / detect_bp / detect_phase_fast
4. API 响应时间（服务在线时）：health / state / heroes / review 各端点
5. 软性预算（budget）：仅记录是否达标，不改变退出码（P2 指标）

跑法：
  python scripts/_test_benchmark.py            # 约 10~20s
  python scripts/_test_benchmark.py --ocr      # 额外测 OCR 阶段识别（+20s）
  python scripts/_test_benchmark.py --repeat 10
输出：_diag/benchmark.json
退出码：0（基准只记录；内部异常除外）
"""
import argparse
import json
import os
import platform
import statistics
import sys
import time
import traceback

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import recognize_screenshot as R  # noqa: E402
import live_recognize as L  # noqa: E402

DIAG = os.path.join(ROOT, '_diag')
OUT_JSON = os.path.join(DIAG, 'benchmark.json')
# 默认 8900；可用 --base 或环境变量 BP_API_BASE 指向其它端口
BASE = os.environ.get('BP_API_BASE', 'http://127.0.0.1:8900').rstrip('/')
SERVER = False

# 软性预算（P2 参考值，超了只记录不失败）
BUDGETS = {
    'feature_bank_init_ms': 3000,
    'warm_up_ms': 1000,
    'recognize_bans_warm_median_ms': 800,
    'recognize_picks_warm_median_ms': 1500,
    'api_health_median_ms': 300,
    'api_review_frames_median_ms': 1000,
    'api_review_crop_ban_median_ms': 1500,
    'api_review_summary_median_ms': 1000,
}


def stats(samples):
    s = sorted(float(x) for x in samples)
    n = len(s)
    return {
        'n': n,
        'min': round(s[0], 2),
        'median': round(statistics.median(s), 2),
        'mean': round(statistics.fmean(s), 2),
        'p90': round(s[min(n - 1, int(round(0.9 * (n - 1))))], 2),
        'max': round(s[-1], 2),
    }


_CURRENT = {'name': None, 'samples': []}


def bench(name, fn, repeat=5, warmup=1):
    """对 fn 做 warmup + repeat 采样，返回 stats。"""
    for _ in range(warmup):
        fn()
    samples = []
    for _ in range(repeat):
        t = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - t) * 1000)
    st = stats(samples)
    print('  %-26s median %8.1fms  (min %.1f / max %.1f)'
          % (name, st['median'], st['min'], st['max']))
    return st


def time_once(fn):
    t = time.perf_counter()
    v = fn()
    return v, (time.perf_counter() - t) * 1000


def frame(name):
    raw = R.imread_unicode(os.path.join(DIAG, name))
    return L.normalize(raw)


# ---------------------------------------------------------------------------
# API 计时
# ---------------------------------------------------------------------------
def api_bench(repeat=5):
    global SERVER
    import requests
    out = {}
    checks = [
        ('GET /api/health', 'GET', '/api/health', {}),
        ('GET /api/state', 'GET', '/api/state', {}),
        ('GET /api/heroes', 'GET', '/api/heroes', {}),
        ('GET /api/review/frames?limit=80', 'GET', '/api/review/frames?limit=80', {}),
        ('GET /api/review/summary', 'GET', '/api/review/summary', {}),
        ('GET /api/review/marks', 'GET', '/api/review/marks', {}),
        ('GET /api/review/export?format=json', 'GET', '/api/review/export?format=json', {}),
        ('GET /api/review/frame_raw', 'GET', '/api/review/frame_raw',
         {'params': {'frame': 'live_ban_234142.png'}}),
        ('GET /api/review/crop(ban)', 'GET', '/api/review/crop',
         {'params': {'frame': 'live_ban_235654.png', 'kind': 'ban',
                     'side': 'blue', 'index': 2}}),
        ('GET /api/review/crop(pick)', 'GET', '/api/review/crop',
         {'params': {'frame': 'live_pick_235855.png', 'kind': 'pick',
                     'side': 'blue', 'index': 4}}),
    ]
    try:
        r = requests.get(BASE + '/api/health', timeout=3)
        SERVER = r.status_code == 200
    except Exception:
        SERVER = False
    if not SERVER:
        print('  [提示] API 服务未启动（%s），跳过 API 计时' % BASE)
        return out, False
    for name, method, path, kw in checks:
        url = BASE + path
        # warmup
        try:
            requests.request(method, url, timeout=60, **kw)
        except Exception:
            pass
        samples = []
        for _ in range(repeat):
            t = time.perf_counter()
            r = requests.request(method, url, timeout=60, **kw)
            samples.append((time.perf_counter() - t) * 1000)
            if r.status_code >= 500:
                break
        st = stats(samples)
        st['status'] = r.status_code
        st['bytes'] = len(r.content)
        out[name] = st
        print('  %-34s median %8.1fms  status=%s bytes=%d'
              % (name, st['median'], r.status_code, len(r.content)))
    return out, True


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    global BASE
    ap = argparse.ArgumentParser(description='性能基准（识别 + API）')
    ap.add_argument('--repeat', type=int, default=5, help='每项采样次数（默认 5）')
    ap.add_argument('--ocr', action='store_true', help='额外测 OCR 阶段识别（慢）')
    ap.add_argument('--base', default=BASE, help='API 地址（默认 8900；也可用 BP_API_BASE）')
    args = ap.parse_args()
    BASE = args.base.rstrip('/')

    print('=' * 80)
    print('  测试小鱼 · 性能基准   %s' % time.strftime('%Y-%m-%d %H:%M:%S'))
    print('=' * 80)
    t_all = time.time()
    report = {
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'env': {
            'python': platform.python_version(),
            'opencv': cv2.__version__,
            'numpy': np.__version__,
            'platform': platform.platform(),
            'cpu_count_logical': os.cpu_count(),
            'processor': platform.processor(),
        },
        'repeat': args.repeat,
        'budgets': BUDGETS,
        'cold_start': {},
        'recognition': {},
        'api': {},
        'api_server_online': False,
        'budget_check': {},
        'notes': [],
    }

    # ---- 1) 帧准备 ----
    frame_names = [
        ('ban', 'live_ban_234153.png'),
        ('selecting', 'live_selecting_234229.png'),
        ('final', 'live_pick_235855.png'),
        ('other', 'live_other_001605.png'),
    ]
    print('\n[1] 读取并归一化真机帧')
    imgs = {}
    for kind, name in frame_names:
        path = os.path.join(DIAG, name)
        if not os.path.isfile(path):
            report['notes'].append('缺少测试帧 %s，跳过相关项' % name)
            continue
        imgs[kind] = {'name': name}
        _, ms = time_once(lambda p=path: R.imread_unicode(p))
        report['recognition'].setdefault('imread_unicode', {})[kind] = round(ms, 2)
        raw = R.imread_unicode(path)
        n, ms = time_once(lambda im=raw: L.normalize(im))
        imgs[kind]['img'] = n
        report['recognition'].setdefault('normalize', {})[kind] = round(ms, 2)
    print('  imread: %s' % {k: report['recognition']['imread_unicode'][k] for k in
                            report['recognition']['imread_unicode']})

    # ---- 2) FeatureBank 冷启动 + warm_up 预热 ----
    print('\n[2] 冷启动')
    bank, init_ms = time_once(lambda: L.FeatureBank())   # 默认 warm=False（不自动预热）
    report['cold_start']['feature_bank_init_ms'] = round(init_ms, 2)
    report['cold_start']['feature_bank_size'] = len(bank.ids)
    print('  FeatureBank 初始化 %.0fms（%d 个英雄）' % (init_ms, len(bank.ids)))
    warm_ms = L.warm_up(bank)
    report['cold_start']['warm_up_ms'] = round(warm_ms, 2)
    print('  warm_up 预热 %.0fms（真实头像 1 个走 ranks + Hough + 分路模板）' % warm_ms)

    ban_img = imgs.get('ban', {}).get('img')
    pick_img = imgs.get('final', {}).get('img')
    if ban_img is not None:
        _, ms = time_once(lambda: L.recognize_bans(ban_img, bank))
        report['cold_start']['first_recognize_bans_ms'] = round(ms, 2)
        print('  首个 recognize_bans %.0fms' % ms)
    if pick_img is not None:
        _, ms = time_once(lambda: L.recognize_picks(pick_img, bank))
        report['cold_start']['first_recognize_picks_ms'] = round(ms, 2)
        print('  首个 recognize_picks %.0fms' % ms)

    # ---- 3) 稳态识别 ----
    print('\n[3] 稳态识别（真实帧，repeat=%d）' % args.repeat)
    rep = max(3, args.repeat)
    if ban_img is not None:
        report['recognition']['recognize_bans'] = bench(
            'recognize_bans(ban 帧)', lambda: L.recognize_bans(ban_img, bank), rep)
    if 'selecting' in imgs:
        img = imgs['selecting']['img']
        report['recognition']['recognize_bans_selecting'] = bench(
            'recognize_bans(selecting)', lambda: L.recognize_bans(img, bank), rep)
        report['recognition']['recognize_picks_selecting'] = bench(
            'recognize_picks(selecting)', lambda: L.recognize_picks(img, bank), rep)
    if pick_img is not None:
        report['recognition']['recognize_picks'] = bench(
            'recognize_picks(final 帧)', lambda: L.recognize_picks(pick_img, bank), rep)

    # crop / is_lane_icon / detect
    if ban_img is not None:
        H, W = ban_img.shape[:2]
        r = max(8, int(round(W * L.BAN_R_RATIO)))
        pos = L.recognize_bans(ban_img, bank)
        crop_pos = (int(round(W * L.BAN_X_RATIOS[1])),
                    int(round(H * L.BAN_Y_RATIO)), r)
        crop = L.crop_avatar(ban_img, *crop_pos)
        report['recognition']['is_lane_icon'] = bench(
            'is_lane_icon(ban 头像裁切)', lambda: L.is_lane_icon(crop), rep)
        report['recognition']['crop_avatar'] = bench(
            'crop_avatar(1920 帧)', lambda: L.crop_avatar(ban_img, *crop_pos), rep)

        lane_img = imgs.get('selecting', {}).get('img')
        if lane_img is not None:
            HH, WW = lane_img.shape[:2]
            rr = max(8, int(round(WW * 0.0234)))
            lane_crop = L.crop_avatar(lane_img, int(round(WW * 0.0859)),
                                      int(round(HH * (0.1713 + 0.1620 * 2))), rr)
            report['recognition']['is_lane_icon_pick'] = bench(
                'is_lane_icon(pick 位裁切)', lambda: L.is_lane_icon(lane_crop), rep)

        report['recognition']['detect_bp'] = bench(
            'detect_bp', lambda: L.detect_bp(ban_img), rep)
        report['recognition']['detect_phase_fast'] = bench(
            'detect_phase_fast', lambda: L.detect_phase_fast(ban_img), rep)

    if args.ocr and imgs.get('other') is not None:
        print('\n[3b] OCR 阶段识别（慢）')
        L._PHASE_CACHE['sig'] = None
        _, ms = time_once(lambda: L.detect_phase(imgs['other']['img']))
        report['recognition']['detect_phase_ocr_cold'] = {'ms': round(ms, 2)}
        print('  detect_phase(OCR) 首次 %.0fms' % ms)
        report['recognition']['detect_phase_ocr_warm'] = bench(
            'detect_phase(OCR, 缓存命中)', lambda: L.detect_phase(imgs['other']['img']),
            max(2, min(rep, 3)))
        L._SELECTING_CACHE['at'] = 0.0
        _, ms = time_once(lambda: L.is_selecting_screen(imgs['other']['img']))
        report['recognition']['is_selecting_screen_ocr'] = {'ms': round(ms, 2)}
        print('  is_selecting_screen(OCR) 首次 %.0fms' % ms)

    # ---- 4) API ----
    print('\n[4] API 响应时间')
    api, online = api_bench(rep)
    report['api'] = api
    report['api_server_online'] = online

    # ---- 5) 预算检查 ----
    checks = []
    if 'feature_bank_init_ms' in report['cold_start']:
        checks.append(('feature_bank_init_ms',
                       report['cold_start']['feature_bank_init_ms'],
                       BUDGETS['feature_bank_init_ms']))
    if 'warm_up_ms' in report['cold_start']:
        checks.append(('warm_up_ms', report['cold_start']['warm_up_ms'],
                       BUDGETS['warm_up_ms']))
    if 'recognize_bans' in report['recognition']:
        checks.append(('recognize_bans_warm_median_ms',
                       report['recognition']['recognize_bans']['median'],
                       BUDGETS['recognize_bans_warm_median_ms']))
    if 'recognize_picks' in report['recognition']:
        checks.append(('recognize_picks_warm_median_ms',
                       report['recognition']['recognize_picks']['median'],
                       BUDGETS['recognize_picks_warm_median_ms']))
    api_budget_map = {
        'api_health_median_ms': 'GET /api/health',
        'api_review_frames_median_ms': 'GET /api/review/frames?limit=80',
        'api_review_crop_ban_median_ms': 'GET /api/review/crop(ban)',
        'api_review_summary_median_ms': 'GET /api/review/summary',
    }
    for budget_key, api_key in api_budget_map.items():
        if api_key in api:
            checks.append((budget_key, api[api_key]['median'], BUDGETS[budget_key]))
    for name, actual, budget in checks:
        ok = actual <= budget
        report['budget_check'][name] = {
            'actual': actual, 'budget': budget, 'ok': ok,
        }
        print('  [%s] %-32s %8.1fms  <= %s'
              % ('OK' if ok else 'SLOW', name, actual, budget))

    report['elapsed_s'] = round(time.time() - t_all, 1)
    report['notes'].append('P2 性能基准：预算超限只记录，不判失败')
    if not online:
        report['notes'].append('API 服务未启动：本次未采集 API 响应时间（启动后重跑即可）')
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print('\n基准已写入 %s（%.1fs）' % (OUT_JSON, report['elapsed_s']))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
