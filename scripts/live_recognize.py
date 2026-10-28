# -*- coding: utf-8 -*-
"""
实战模式：ADB 自动抓屏 → BP 状态机 → 多帧识别 → 自动采集样本
=================================================================
你打游戏时双击「实时识别.bat」启动，然后就不用管了：
  · 自动检测是否进入 ban 阶段界面
  · ban 完成后自动识别 10 个 ban 位（多帧候选 RRF 融合，比单帧稳）
  · 结果同时打印在窗口、写入 最新结果.txt
  · 自动把 10 个头像裁剪入库（training_data/live/），供度量学习训练

用法：
  python scripts/live_recognize.py              # 常驻循环
  python scripts/live_recognize.py --once       # 只检测一次（调试）
  python scripts/live_recognize.py --no-sample  # 不采集样本

退出：Ctrl+C
"""
import argparse
import collections
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recognize_screenshot as R

# Windows 下隐藏子进程窗口
CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0


def _run(cmd, **kwargs):
    kwargs.setdefault('creationflags', CREATE_NO_WINDOW)
    return subprocess.run(cmd, **kwargs)


DEFAULT_ADB = r'D:\scrcpy\adb.exe'
TARGET_WIDTH = 1920
OUT_CAPTURE = '_live_capture'       # 调试截图
OUT_SAMPLES = 'training_data/live'  # 训练样本
RESULT_FILE = '最新结果.txt'

# 识别参数（实测最优）
FUSION_K = 60
FUSION_W_COLOR = 2.5
MULTI_FRAMES = 3              # 多帧融合帧数
# 融合分（RRF）量纲约 0~0.0574：0.0574 = ORB第1+颜色第1 的完美匹配。
# top1-top2 分差 >= 0.003 视为可信（实测正确样本 gap 约 0.001~0.01）。
CONFIDENT_GAP = 0.0025


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------
def find_adb(explicit=None):
    for c in ([explicit] if explicit else []) + [DEFAULT_ADB, 'adb']:
        try:
            r = _run([c, 'version'], capture_output=True,
                               encoding='utf-8', errors='replace', timeout=8)
            if r.returncode == 0 and 'Android Debug Bridge' in (r.stdout or ''):
                return c
        except Exception:
            continue
    return None


def list_devices(adb):
    r = _run([adb, 'devices'], capture_output=True,
                       encoding='utf-8', errors='replace', timeout=15)
    out = []
    for line in (r.stdout or '').splitlines():
        p = line.strip().split()
        if len(p) >= 2 and not line.startswith('List of devices'):
            out.append((p[0], p[1]))
    return out


def capture(adb, serial):
    cmd = [adb] + (['-s', serial] if serial else []) + ['exec-out', 'screencap', '-p']
    r = _run(cmd, capture_output=True, timeout=30)
    data = r.stdout or b''
    if not data.startswith(b'\x89PNG'):
        data = data.replace(b'\r\n', b'\n')
    if not data.startswith(b'\x89PNG'):
        raise RuntimeError('抓屏不是 PNG')
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError('PNG 解码失败')
    return img


def normalize(img):
    h, w = img.shape[:2]
    if w == TARGET_WIDTH:
        return img
    return cv2.resize(img, (TARGET_WIDTH, int(round(h * TARGET_WIDTH / w))),
                      interpolation=cv2.INTER_AREA)


# ---------------------------------------------------------------------------
# 特征库（加载一次）
# ---------------------------------------------------------------------------
class FeatureBank:
    def __init__(self):
        manifest = json.load(open('avatars/manifest.json', encoding='utf-8'))
        self.ids = [m['id'] for m in manifest]
        self.name = {m['id']: m['name'] for m in manifest}
        self.orb = cv2.ORB_create(nfeatures=1000)
        self.des = {}
        self.col = {}
        for m in manifest:
            raw = R.imread_unicode('avatars/%s.jpg' % m['id'])
            av = R.circular(raw, 48)
            kp, d = self.orb.detectAndCompute(av, None)
            if d is not None:
                self.des[m['id']] = d
            self.col[m['id']] = R._color_hist(raw)
        self.bf = cv2.BFMatcher(cv2.NORM_HAMMING)

    def _match(self, a, b):
        ms = self.bf.knnMatch(a, b, k=2)
        return len([m for m, n in ms if m.distance < 0.75 * n.distance])

    def ranks(self, crop):
        """返回该头像的 (ORB排名, 颜色排名)。"""
        q = R.circular(crop, int(crop.shape[0]))
        qdes = self.orb.detectAndCompute(q, None)[1]
        if qdes is None:
            return ({h: i + 1 for i, h in enumerate(self.ids)},
                    {h: i + 1 for i, h in enumerate(self.ids)})
        os_ = {h: self._match(qdes, d) for h, d in self.des.items()}
        qcol = R._color_hist(crop)
        cd = {h: R._chi2(qcol, self.col[h]) for h in self.ids}
        OR = {h: i + 1 for i, (h, s) in enumerate(sorted(os_.items(), key=lambda kv: -kv[1]))}
        CR = {h: i + 1 for i, (h, d) in enumerate(sorted(cd.items(), key=lambda kv: kv[1]))}
        return OR, CR

    def fuse(self, rank_pairs):
        """多帧 RRF 融合，返回 [(hero_id, score)] 降序。"""
        comb = {}
        for OR, CR in rank_pairs:
            for h in self.ids:
                comb[h] = comb.get(h, 0.0) + \
                    1.0 / (FUSION_K + OR.get(h, 999)) + \
                    FUSION_W_COLOR / (FUSION_K + CR.get(h, 999))
        return sorted(comb.items(), key=lambda kv: -kv[1])


# ---------------------------------------------------------------------------
# BP 检测
# ---------------------------------------------------------------------------
def _evenly_spaced(circles, max_cv=0.35):
    """间距变异系数：王者 ban 位严格等距（CV≈0），其他画面误检的圆间距杂乱。"""
    if len(circles) < 3:
        return True
    xs = sorted(c[0] for c in circles)
    gaps = [xs[i + 1] - xs[i] for i in range(len(xs) - 1)]
    mg = float(np.mean(gaps))
    if mg <= 0:
        return False
    return float(np.std(gaps) / mg) <= max_cv


def _top_brightness(img, ratio=0.12):
    """ban 栏区域平均亮度（王者 BP 是深色背景，实测 V≈59~119）。"""
    H = img.shape[0]
    top = img[0:int(H * ratio), :]
    hsv = cv2.cvtColor(top, cv2.COLOR_BGR2HSV)
    return float(hsv[:, :, 2].mean())


# ---------------------------------------------------------------------------
# BP 阶段识别（模板匹配顶部横幅文字）
# 「禁英雄」= ban 阶段；「等待其他玩家选择」= pick 阶段
# ---------------------------------------------------------------------------
_PHASE_TEMPLATES = None
PHASE_TPL_W, PHASE_TPL_H = 256, 50
PHASE_REF_WIDTH = 1920      # 模板基准分辨率宽度

# 模板文件名 → 阶段名
_PHASE_TPL_MAP = {
    'ban': 'ban',             # 「禁英雄」（视频帧，1280x720）
    'pick': 'pick',           # 「等待其他玩家选择」（视频帧）
    'pick2': 'pick',          # 「等待其他玩家选择」（真机 1280x576）
    'final_adjust': 'final',  # 「最后调整」（真机 1920x864）
}


def _load_phase_templates():
    global _PHASE_TEMPLATES
    if _PHASE_TEMPLATES is None:
        _PHASE_TEMPLATES = []
        for fname, phase in _PHASE_TPL_MAP.items():
            p = os.path.join('models', 'templates', '%s.png' % fname)
            if os.path.exists(p):
                t = cv2.imread(p)
                if t is not None:
                    _PHASE_TEMPLATES.append((phase, t))
    return _PHASE_TEMPLATES


_SELECTING_CACHE = {'at': 0.0, 'value': False}


def is_selecting_screen(img, threshold=15):
    """检测是否「玩家选英雄」界面（不是 BP 抢位界面）。

    关键差异（实测）：
      - 选人界面：中间英雄池有大量文本（英雄名 + 场次），OCR 约 42 条
      - BP 抢位界面：中间是 VS/空白，OCR 约 0 条

    选人界面不能识别 pick（队伍头像是玩家预选，不是最终阵容）。
    OCR 较慢，3 秒内复用上次结果。
    """
    now = __import__('time').time()
    if now - _SELECTING_CACHE['at'] < 3.0:
        return _SELECTING_CACHE['value']
    H, W = img.shape[:2]
    roi = img[int(H * 0.20):int(H * 0.75), int(W * 0.22):int(W * 0.78)]
    if roi.size == 0:
        return False
    o = _get_ocr()
    if not o:
        return False
    try:
        res = o(roi)
    except Exception:
        return False
    n = 0
    if res and res[0]:
        for line in res[0]:
            t = line[1][0] if isinstance(line[1], (list, tuple)) else str(line[1])
            if t and t.strip():
                n += 1
    value = n > threshold
    _SELECTING_CACHE['at'] = now
    _SELECTING_CACHE['value'] = value
    return value


def _detect_phase_tpl(img, threshold=0.55):
    """模板匹配兜底（OCR 不可用时）。见下方 detect_phase。"""
    tpls = _load_phase_templates()
    if not tpls:
        return 'other', 0.0
    H, W = img.shape[:2]
    top_h = max(1, int(H * 0.25))
    region = img[0:top_h, :]
    scale = PHASE_REF_WIDTH / float(W)
    region = cv2.resize(region, (PHASE_REF_WIDTH, max(1, int(round(top_h * scale)))),
                        interpolation=cv2.INTER_AREA)
    if region.shape[0] < PHASE_TPL_H:
        return 'other', 0.0
    best_phase, best_score = 'other', 0.0
    for phase, tpl in tpls:
        for sc in (0.8, 1.0, 1.25):
            tw = max(8, int(PHASE_TPL_W * sc))
            th = max(4, int(PHASE_TPL_H * sc))
            if th > region.shape[0] or tw > region.shape[1]:
                continue
            t = cv2.resize(tpl, (tw, th), interpolation=cv2.INTER_AREA)
            res = cv2.matchTemplate(region, t, cv2.TM_CCOEFF_NORMED)
            _, s, _, _ = cv2.minMaxLoc(res)
            if s > best_score:
                best_score, best_phase = float(s), phase
    if best_score < threshold:
        return 'other', best_score
    return best_phase, best_score


# ---------------------------------------------------------------------------
# OCR 阶段识别（主方案，实测 8/8 准确）
# 顶部横幅文字：「禁英雄」/「等待其他玩家选择」/「最后调整」
# ---------------------------------------------------------------------------
_OCR_ENGINE = None
_OCR_UNAVAILABLE = False
PHASE_KEYWORDS = [
    ('最后调整', 'final'),
    # 「准备前往发育路/游走」= 选人确认阶段（真机 final）
    ('准备前往', 'final'),
    ('等待其他玩家选择', 'pick'),
    ('请选择您的', 'pick'),        # 真机 pick 阶段实际文案
    ('禁英雄', 'ban'),
    ('等待其他玩家禁用', 'ban'),   # 真机 ban 阶段实际文案（推测）
    ('禁用英雄', 'ban'),
    # 「禁用结果」= ban 完成后的结果展示（真机 ban 界面变体）
    ('禁用结果', 'ban'),
]
_PHASE_CACHE = {'sig': None, 'phase': 'other', 'score': 0.0}


def _get_ocr():
    """懒加载 OCR 单例（首次约 1~2 秒，之后复用）。"""
    global _OCR_ENGINE, _OCR_UNAVAILABLE
    if _OCR_ENGINE is None and not _OCR_UNAVAILABLE:
        try:
            from rapidocr_onnxruntime import RapidOCR
            _OCR_ENGINE = RapidOCR()
        except Exception:
            _OCR_UNAVAILABLE = True
    return _OCR_ENGINE


def _count_ban_slots(img):
    """数 ban 位圆个数（不识别英雄，毫秒级）。"""
    left, right = R.detect_circles(img)
    return len(R.validate_row(left)) + len(R.validate_row(right))


def _count_filled_picks(img, empty_std=20.0):
    """数非空 pick 位个数（只看灰度标准差，不识别英雄，毫秒级）。"""
    H, W = img.shape[:2]
    n = 0
    for x_ratio in (0.0859, 1.0 - 0.0859):
        x = int(round(W * x_ratio))
        for i in range(5):
            cy = int(round(H * (0.1713 + 0.1620 * i)))
            half = max(8, int(round(W * 0.0234)))
            crop = img[max(0, cy - half):cy + half,
                       max(0, x - half):x + half]
            if crop.size == 0:
                continue
            if float(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).std()) >= empty_std:
                n += 1
    return n


def detect_phase_fast(img):
    """基于布局快速判断阶段（毫秒级，不 OCR）。

    返回 (phase, confident)：
      ('final', True)  pick 位 >= 9 个有内容
      ('pick', True)   pick 位 >= 1 个有内容，或 ban 位已满（等待选将）
      ('ban', True)    ban 位 1~7 个（正在 ban）
      ('unknown', False) 判断不出（ban 位 0 个，需 OCR 兜底）
    """
    ban = _count_ban_slots(img)
    picks = _count_filled_picks(img)
    if picks >= 9:
        return 'final', True
    if picks >= 1:
        return 'pick', True
    if ban >= 8:
        # ban 位已满但还没人选 —— 处于「等待其他玩家选择」
        return 'pick', True
    if 1 <= ban <= 7:
        return 'ban', True
    return 'unknown', False


def detect_phase_fast_ocr(img):
    """布局无法判断时用 OCR 兜底（慢，~2s）。"""
    ocr = _get_ocr()
    if ocr is None:
        return 'other', 0.0
    H, W = img.shape[:2]
    top = img[0:max(1, int(H * 0.35)), :]
    top = cv2.resize(top, (top.shape[1] * 2, top.shape[0] * 2),
                     interpolation=cv2.INTER_CUBIC)
    try:
        result, _ = ocr(top)
    except Exception:
        result = None
    if result:
        joined = ''.join(str(item[1]) for item in result)
        for kw, phase in PHASE_KEYWORDS:
            if kw in joined:
                return phase, 1.0
    return 'other', 0.0


def detect_phase(img, use_ocr=True):
    """识别当前 BP 阶段。

    返回 (phase, score)：
      'ban'   禁英雄阶段
      'pick'  选将阶段（等待其他玩家选择）
      'final' 最后调整（BP 已完成，ban 和 pick 都确定）
      'other' 其他（匹配/加载/游戏内）

    主方案：OCR 识别顶部 12% 横幅文字（实测 8/8 准确，含视频/真机各种分辨率）。
    兜底：OCR 不可用时回退模板匹配。
    """
    global _PHASE_CACHE
    H, W = img.shape[:2]
    # ① 帧差缓存：顶部横幅几乎没变 → 复用上次 OCR 结果（毫秒级）
    top = img[0:max(1, int(H * 0.35)), :]
    sig = cv2.resize(top, (160, 45), interpolation=cv2.INTER_AREA).astype(np.float32)
    if _PHASE_CACHE['sig'] is not None:
        diff = float(np.abs(sig - _PHASE_CACHE['sig']).mean())
        if diff < 3.0:
            return _PHASE_CACHE['phase'], _PHASE_CACHE['score']
    if not use_ocr:
        return _detect_phase_tpl(img)
    # ② OCR 识别（~2s，但只在顶部变化时执行）
    ocr = _get_ocr()
    if ocr is not None:
        top2 = cv2.resize(top, (top.shape[1] * 2, top.shape[0] * 2),
                          interpolation=cv2.INTER_CUBIC)
        try:
            result, _ = ocr(top2)
        except Exception:
            result = None
        phase, score = 'other', 0.0
        if result:
            joined = ''.join(str(item[1]) for item in result)
            for kw, ph in PHASE_KEYWORDS:
                if kw in joined:
                    phase, score = ph, 1.0
                    break
        _PHASE_CACHE['sig'] = sig
        _PHASE_CACHE['phase'] = phase
        _PHASE_CACHE['score'] = score
        return phase, score
    return _detect_phase_tpl(img)


def detect_bp(img):
    """判断是否王者 BP 界面（需要同时满足布局 + 场景特征）。

    实测区分度（碧蓝航线作为反例）：
      | 画面        | 左右圆 | 等距 | 锁数 | 顶部亮度 |
      |-------------|--------|------|------|----------|
      | 王者 BP     | 5 / 5  | 是   | 9~10 | 59~119   |
      | 碧蓝航线     | 2~5    | 否   | 0~3  | 213~215  |

    判据：布局(左右各>=3) + 等距 + (锁>=4 或 顶部亮度<120)。
    """
    H, W = img.shape[:2]
    left, right = R.detect_circles(img)
    max_r = W * 0.02          # ban 头像半径约 1~1.4% 屏宽
    left = [c for c in left if c[2] <= max_r]
    right = [c for c in right if c[2] <= max_r]
    left = R.validate_row(left)
    right = R.validate_row(right)

    locks = sum(1 for c in (left + right) if R.has_lock(img, *c))
    top_v = _top_brightness(img)
    layout_ok = (len(left) >= 3 and len(right) >= 3
                 and _evenly_spaced(left) and _evenly_spaced(right))
    # 真 BP 界面通常 9~10 个锁；BP 早期锁少但背景是深色（实测 V≈59~119）。
    # 非 BP 画面常见：亮背景（V>150）且无锁 → 排除。
    # 注意：真机分辨率/UI 差异可能导致锁检测偏少，这里放宽，靠「识别质量校验」兜底。
    scene_ok = (locks >= 3) or (top_v < 130)

    return {
        'left': left, 'right': right,
        'count': len(left) + len(right),
        'locks': locks, 'top_v': round(top_v, 1),
        'is_bp': bool(layout_ok and scene_ok),
    }


def detect_result_hero(img, bank):
    """从结算界面识别玩家自己使用的英雄（MVP 圆形头像）。

    结算界面玩家英雄头像位置固定（实测：x=0.378W, y=0.497H, r=0.032W）。
    MVP 画面识别准确（圆形遮罩后 3/3 一致，如猪八戒 0.0543）；
    非 MVP 画面该位置无头像，会给出低置信结果，调用方应跳过。

    返回 {'hero_id','name','score','gap','confident'} 或 None
    """
    H, W = img.shape[:2]
    cx, cy = int(W * 0.378), int(H * 0.497)
    r = max(12, int(W * 0.032))
    rr = max(10, int(r * 0.85))
    x0, x1 = max(0, cx - rr), min(W, cx + rr)
    y0, y1 = max(0, cy - rr), min(H, cy + rr)
    crop = img[y0:y1, x0:x1].copy()
    if crop.size == 0:
        return None
    h, w = crop.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    cv2.circle(mask, (w // 2, h // 2), max(4, min(h, w) // 2 - 2), 255, -1)
    masked = cv2.bitwise_and(crop, crop, mask=mask)
    crop2 = cv2.resize(masked, (96, 96))
    fused = bank.fuse([bank.ranks(crop2)])
    top = fused[0]
    second = fused[1] if len(fused) > 1 else (None, 0)
    gap = top[1] - second[1]
    return {
        'hero_id': top[0],
        'name': bank.name.get(top[0], top[0]),
        'score': round(top[1], 4),
        'gap': round(gap, 4),
        # 圆形遮罩后 gap 偏小，结算头像用专用阈值（实测正解 0.0021，误判 ≤0.0009）
        'confident': gap >= 0.0012,
    }


_PICKS_CACHE = {'sig': None, 'picks': None}


def _pick_signature(img):
    """10 个 pick 位的快速签名（每个 4x4 降采样）。"""
    H, W = img.shape[:2]
    parts = []
    for x_ratio in (0.0859, 1.0 - 0.0859):
        x = int(round(W * x_ratio))
        for i in range(5):
            cy = int(round(H * (0.1713 + 0.1620 * i)))
            half = max(8, int(round(W * 0.0234)))
            crop = img[max(0, cy - half):cy + half,
                       max(0, x - half):x + half]
            if crop.size == 0:
                parts.append(np.zeros(16, np.float32))
                continue
            parts.append(cv2.resize(crop, (4, 4)).astype(np.float32).flatten())
    return np.concatenate(parts)


def recognize_picks_cached(img, bank, empty_std=20.0, threshold=4.0):
    """带缓存的 pick 识别：pick 位画面几乎没变时复用上次结果（毫秒级）。"""
    global _PICKS_CACHE
    sig = _pick_signature(img)
    if _PICKS_CACHE['sig'] is not None:
        diff = float(np.abs(sig - _PICKS_CACHE['sig']).mean())
        if diff < threshold:
            return _PICKS_CACHE['picks']
    picks = recognize_picks(img, bank, empty_std)
    _PICKS_CACHE['sig'] = sig
    _PICKS_CACHE['picks'] = picks
    return picks


def detect_player_floor(img):
    """识别玩家所在楼层（巅峰赛名字为金黄色）。

    做法（实测 4 个样本 3 个正确）：
      1. OCR 左侧 32% 区域，只保留含「召唤师」的文本
         （排除「铭文特权/150/预选」等同样是金色的 UI 干扰）
      2. 按 y 排序 → 楼层（1~5）
      3. 金色像素比例最高的名字 = 玩家

    返回 (floor_1based, names) ；失败返回 (None, [])
    """
    ocr = _get_ocr()
    if ocr is None:
        return None, []
    H, W = img.shape[:2]
    crop = img[:, 0:max(1, int(W * 0.32))]
    crop2 = cv2.resize(crop, (crop.shape[1] * 2, crop.shape[0] * 2),
                       interpolation=cv2.INTER_CUBIC)
    cw, ch = crop2.shape[1], crop2.shape[0]
    try:
        result, _ = ocr(crop2)
    except Exception:
        return None, []
    if not result:
        return None, []
    hsv = cv2.cvtColor(crop2, cv2.COLOR_BGR2HSV)
    h = hsv[:, :, 0].astype(int)
    s = hsv[:, :, 1].astype(int)
    v = hsv[:, :, 2].astype(int)
    gold = (h >= 15) & (h <= 45) & (s > 90) & (v > 130)

    names = []
    for item in result:
        try:
            box, text, conf = item[0], str(item[1]), float(item[2])
        except Exception:
            continue
        if conf < 0.5 or '召唤师' not in text:
            continue
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        x0, x1 = int(min(xs)), int(max(xs))
        y0, y1 = int(min(ys)), int(max(ys))
        region = gold[max(0, y0):min(ch, y1), max(0, x0):min(cw, x1)]
        n = max(1, region.size)
        names.append({'text': text, 'y': (y0 + y1) / 2.0,
                      'gold': int(region.sum()),
                      'ratio': int(region.sum()) / float(n)})
    if not names:
        return None, []
    names.sort(key=lambda r: r['y'])
    merged = []
    for nm in names:
        if merged and abs(nm['y'] - merged[-1]['y']) < 80:
            if nm['gold'] > merged[-1]['gold']:
                merged[-1] = nm
            continue
        merged.append(nm)
    best_idx = max(range(len(merged)), key=lambda i: merged[i]['ratio'])
    return best_idx + 1, merged


def detect_game_result(img):
    """识别对局结算界面（王者巅峰赛/排位）。

    依据（实测 OCR 结果）：
      - 结算界面特征：出现「巅峰积分」「点击此处继续」「全场最佳」
      - 胜负：巅峰积分变化符号（如 2201(+13) = 赢，2201(-10) = 输）
      - MVP：出现「MVP」或「你就是全场最佳」

    返回 {'is_result', 'result', 'is_mvp', 'delta', 'texts'}
    """
    ocr = _get_ocr()
    empty = {'is_result': False, 'result': None, 'is_mvp': False,
             'delta': None, 'texts': []}
    if ocr is None:
        return empty
    H, W = img.shape[:2]
    # 结算信息集中在中间区域（去掉顶部广告/状态栏和底部）
    crop = img[int(H * 0.08):int(H * 0.86), :]
    if crop.size == 0:
        return empty
    crop = cv2.resize(crop, (crop.shape[1] * 2, crop.shape[0] * 2),
                      interpolation=cv2.INTER_CUBIC)
    try:
        result, _ = ocr(crop)
    except Exception:
        return empty
    if not result:
        return empty
    texts = [str(item[1]) for item in result]
    joined = ' '.join(texts)

    is_result = any(k in joined for k in
                    ('巅峰积分', '点击此处继续', '全场最佳', '对局结算', '战绩详情'))
    if not is_result:
        return empty

    is_mvp = ('MVP' in joined.upper()) or ('全场最佳' in joined)

    # 巅峰积分变化：取第一个「数字(±N)」模式（最靠前的就是积分）
    import re
    delta = None
    result_side = None
    m = re.search(r'\d{2,5}\s*[（(]\s*([+\-−±])\s*(\d+)\s*[)）]', joined)
    if m:
        sign, num = m.group(1), int(m.group(2))
        if sign == '+':
            result_side, delta = 'WIN', num
        elif sign in '-−':
            result_side, delta = 'LOSE', -num
    return {'is_result': True, 'result': result_side, 'is_mvp': is_mvp,
            'delta': delta, 'texts': texts}


def recognize_picks(img, bank, empty_std=25.0):
    """识别左右各 5 个 pick 位（方形头像）。

    坐标基准（1920x864 归一化画面，实测自巅峰赛截图）：
      x = 1920*0.0859 ≈ 165（我方）/ 对称位置（敌方）
      y = 864*0.1713 + 864*0.1620*i  （第 i 个，0-based）
      size = 1920*0.0469 ≈ 90

    空位判断：空 pick 位是深色均匀背景，灰度标准差很低（实测 11 vs 有头像 44~66）。

    返回 [{side, index, hero_id, name, score, gap, confident, empty}, ...]
    """
    H, W = img.shape[:2]
    picks = []
    for side, x_ratio in (('blue', 0.0859), ('red', 1.0 - 0.0859)):
        x = int(round(W * x_ratio))
        for i in range(5):
            cy = int(round(H * (0.1713 + 0.1620 * i)))
            half = max(8, int(round(W * 0.0234)))
            y0, y1 = max(0, cy - half), min(H, cy + half)
            x0, x1 = max(0, x - half), min(W, x + half)
            crop = img[y0:y1, x0:x1]
            if crop.size == 0:
                continue
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            if float(gray.std()) < empty_std:
                picks.append({'side': side, 'index': i + 1, 'hero_id': None,
                              'name': '', 'score': 0.0, 'gap': 0.0,
                              'confident': False, 'empty': True})
                continue
            fused = bank.fuse([bank.ranks(crop)])
            top = fused[0]
            second = fused[1] if len(fused) > 1 else (None, 0)
            gap = top[1] - second[1]
            picks.append({
                'side': side, 'index': i + 1,
                'hero_id': top[0],
                'name': bank.name.get(top[0], top[0]),
                'score': round(top[1], 4),
                'gap': round(gap, 4),
                'confident': gap >= CONFIDENT_GAP,
                'empty': False,
            })
    # 同队去重：同一英雄不可能出现在同队两个位置（分路图标误识别时常见）
    # 保留 gap 高的那个，其余置空
    for side in ('blue', 'red'):
        seen = {}  # hero_id -> pick 在下标
        for idx, p in enumerate(picks):
            if p['side'] != side or p['empty'] or not p['hero_id']:
                continue
            hid = p['hero_id']
            if hid in seen:
                prev = picks[seen[hid]]
                if p['gap'] > prev['gap']:
                    # 当前更好 → 前一个置空
                    prev.update({'hero_id': None, 'name': '', 'gap': 0.0,
                                 'confident': False, 'empty': True})
                    seen[hid] = idx
                else:
                    # 前一个更好 → 当前置空
                    p.update({'hero_id': None, 'name': '', 'gap': 0.0,
                              'confident': False, 'empty': True})
            else:
                seen[hid] = idx
    return picks


def detect_user_side(img, red_threshold=1.8):
    """判断我方阵营（左侧菱形框颜色）。

    王者 BP 界面：我方永远在左，敌方在右。
    左侧头像的菱形框颜色 = 我方阵营（红框=红方，蓝框=蓝方）。
    实测区分度：左侧红 75.4% vs 蓝 4.1%；右侧红 7.8% vs 蓝 89%。

    返回 'RED' / 'BLUE' / None（判断不出）
    """
    H, W = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h = hsv[:, :, 0].astype(int)
    s = hsv[:, :, 1].astype(int)
    v = hsv[:, :, 2].astype(int)
    sat = (s > 90) & (v > 90)
    # 左侧头像区（x 3%~13%，y 8%~72%）——只取我方
    x0, x1 = int(W * 0.03), int(W * 0.13)
    y0, y1 = int(H * 0.08), int(H * 0.72)
    region = np.zeros((H, W), bool)
    region[y0:y1, x0:x1] = True
    mask = sat & region
    n = int(mask.sum())
    if n < 300:
        return None
    hh = h[mask]
    red = int((((hh < 12) | (hh > 165))).sum())
    blue = int(((hh >= 95) & (hh <= 135)).sum())
    if red >= blue * red_threshold:
        return 'RED'
    if blue >= red * red_threshold:
        return 'BLUE'
    return None


# ban 位固定坐标（1920x864 基准实测，真机截图验证）
# 左侧 5 个：x=0.0729~0.1927（间距约 0.030），顶部 y=0.044，半径 0.012W
BAN_X_RATIOS = [0.0722, 0.1022, 0.1322, 0.1622, 0.1909]
BAN_Y_RATIO = 0.044
BAN_R_RATIO = 0.012
BAN_EMPTY_STD = 15.0   # 空 ban 位灰度标准差阈值（真机实测：空位 6~8 / 有头像 19~55）


def _recognize_positions(img, bank, positions, empty_std):
    """按给定位置 [(side, index, (cx,cy,r))] 裁剪并识别。"""
    out = []
    for side, idx, (cx, cy, r) in positions:
        crop = crop_avatar(img, int(round(cx)), int(round(cy)), int(round(r)))
        if crop is None:
            continue
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        if float(gray.std()) < empty_std:
            continue  # 空 ban 位
        fused = bank.fuse([bank.ranks(crop)])
        top = fused[0]
        second = fused[1] if len(fused) > 1 else (None, 0)
        gap = top[1] - second[1]
        out.append({
            'side': side, 'index': idx,
            'hero_id': top[0],
            'name': bank.name.get(top[0], top[0]),
            'score': round(top[1], 4),
            'gap': round(gap, 4),
            'confident': gap >= CONFIDENT_GAP,
        })
    return out


def recognize_bans(img, bank, empty_std=BAN_EMPTY_STD):
    """识别顶部 ban 位（空 ban 位跳过）。

    坐标方案（双保险）：
      1) 优先 HoughCircles + validate_row（自适应，和 adb_console 一致）
         —— 今天实测 7 帧全部 left=5 right=5，坐标精确贴合
      2) Hough 失败时 fallback 到固定比例坐标
      空位判断：头像区域灰度标准差 < empty_std（空位 8~18 / 有头像 48~68）

    返回 [{side, index, hero_id, name, score, gap, confident}, ...]
    """
    # ---- 1) Hough 检测圆（自适应）----
    try:
        left, right = R.detect_circles(img)
        l2 = R.validate_row(left) if left else []
        r2 = R.validate_row(right) if right else []
        if len(l2) == 5 and len(r2) == 5:
            positions = ([('blue', i + 1, c) for i, c in enumerate(l2)] +
                         [('red', i + 1, c) for i, c in enumerate(r2)])
            out = _recognize_positions(img, bank, positions, empty_std)
            if out:
                return out
    except Exception:
        pass

    # ---- 2) fallback: 固定比例坐标 ----
    H, W = img.shape[:2]
    r = max(8, int(round(W * BAN_R_RATIO)))
    cy = int(round(H * BAN_Y_RATIO))
    out = []
    for side, ratios in (('blue', BAN_X_RATIOS),
                         ('red', [1.0 - x for x in BAN_X_RATIOS])):
        for idx, xr in enumerate(ratios, 1):
            cx = int(round(W * xr))
            crop = crop_avatar(img, cx, cy, r)
            if crop is None:
                continue
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            if float(gray.std()) < empty_std:
                continue  # 空 ban 位
            fused = bank.fuse([bank.ranks(crop)])
            top = fused[0]
            second = fused[1] if len(fused) > 1 else (None, 0)
            gap = top[1] - second[1]
            out.append({
                'side': side, 'index': idx,
                'hero_id': top[0],
                'name': bank.name.get(top[0], top[0]),
                'score': round(top[1], 4),
                'gap': round(gap, 4),
                'confident': gap >= CONFIDENT_GAP,
            })
    return out


def format_bans(bans):
    """格式化 ban 位为一行文字。"""
    if not bans:
        return 'ban: (空)'
    parts = []
    for side, label in (('blue', '我方'), ('red', '敌方')):
        items = [b for b in bans if b['side'] == side]
        if not items:
            continue
        txt = ' / '.join('%s%s' % (b['name'], '' if b['confident'] else '?') for b in items)
        parts.append('%s: %s' % (label, txt))
    return 'ban: ' + '  |  '.join(parts)


def crop_avatar(img, cx, cy, r, size=96):
    H, W = img.shape[:2]
    sz = int(r * 2.2)
    x = max(0, min(W - sz, cx - sz // 2))
    y = max(0, min(H - sz, cy - sz // 2))
    return cv2.resize(img[y:y + sz, x:x + sz], (size, size))


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def write_result(text):
    with open(RESULT_FILE, 'w', encoding='utf-8') as f:
        f.write(text + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--adb-path', default=None)
    ap.add_argument('--serial', default=None)
    ap.add_argument('--once', action='store_true', help='只检测一次')
    ap.add_argument('--no-sample', action='store_true', help='不采集样本')
    ap.add_argument('--interval', type=float, default=1.0, help='轮询间隔秒')
    args = ap.parse_args()

    print('=' * 62)
    print('  王者BP助手 · 实战识别（自动检测 BP + 识别 + 采样本）')
    print('=' * 62)

    adb = find_adb(args.adb_path)
    if not adb:
        print('[X] 未找到 adb，请确认 D:\\scrcpy\\adb.exe 存在')
        return 1
    devices = list_devices(adb)
    if not devices:
        print('[X] 没有设备。请用数据线连手机并开启 USB 调试。')
        return 2
    print('[1] 检测到设备: %s' % ', '.join('%s(%s)' % (s, st) for s, st in devices))
    # 优先真机（USB 序列号一般不是回环地址/emulator-），避免选中残留模拟器
    ready = [s for s, st in devices if st == 'device']
    real = [s for s in ready if not s.startswith('127.0.0.1') and not s.startswith('emulator-')]
    pick = real or ready
    serial = args.serial or (pick[0] if pick else None)
    if not serial:
        print('[X] 设备未就绪（状态非 device）：请在手机上点「允许 USB 调试」。')
        return 3
    print('    使用设备: %s%s' % (serial, '（真机）' if serial in real else '（模拟器/回环）'))
    if len(ready) > 1:
        print('    提示：检测到多个设备，如需指定请加 --serial <序列号>')

    print('[2] 加载英雄特征库（132 个）...')
    t0 = time.time()
    bank = FeatureBank()
    print('    完成，耗时 %.2f 秒' % (time.time() - t0))

    os.makedirs(OUT_CAPTURE, exist_ok=True)
    os.makedirs(OUT_SAMPLES, exist_ok=True)

    state = 'IDLE'
    stable = 0            # 连续 BP 帧数
    recognized = False    # 本轮是否已识别
    silent = 0            # 连续非 BP 帧数
    runs = 0

    print('[3] 开始监听（每 %.1f 秒抓一帧），Ctrl+C 退出' % args.interval)
    print('    提示：进入王者荣耀 ban 阶段后会自动识别\n')

    while True:
        try:
            raw = capture(adb, serial)
            img = normalize(raw)
            bp = detect_bp(img)

            if bp['is_bp']:
                stable += 1
                silent = 0
                if state != 'IN_BP':
                    state = 'IN_BP'
                    print('[检测] 进入 BP 界面（左%d 右%d，锁%d，顶部V=%.0f）' % (
                        len(bp['left']), len(bp['right']), bp['locks'], bp['top_v']))
                # 连续稳定 + 未识别 → 触发识别
                if stable >= 2 and not recognized:
                    print('[识别] ban 位稳定，抓 %d 帧融合识别...' % MULTI_FRAMES)
                    t1 = time.time()
                    frames = [img]
                    for _ in range(MULTI_FRAMES - 1):
                        try:
                            frames.append(normalize(capture(adb, serial)))
                        except Exception:
                            pass
                    left, right = bp['left'], bp['right']
                    allc = list(left) + list(right)
                    # 锁检测：新 UI 有锁系统时，无锁位 = 空 ban
                    has_locks = [R.has_lock(img, cx, cy, r) for (cx, cy, r) in allc]
                    use_lock = sum(has_locks) >= 2

                    picks = []
                    top_scores = []
                    for j, (cx, cy, r) in enumerate(allc):
                        side = 'blue' if j < len(left) else 'red'
                        idx = (j if j < len(left) else j - len(left)) + 1
                        if use_lock and not has_locks[j]:
                            picks.append({
                                'side': side, 'index': idx,
                                'hero_id': None, 'name': None,
                                'score': 0.0, 'gap': 0.0, 'confident': True,
                                'pos': [cx, cy, r], 'empty': True,
                            })
                            continue
                        rank_pairs = [bank.ranks(crop_avatar(f, cx, cy, r)) for f in frames]
                        fused = bank.fuse(rank_pairs)
                        top = fused[0]
                        second = fused[1] if len(fused) > 1 else (None, 0)
                        gap = top[1] - second[1]
                        top_scores.append(top[1])
                        picks.append({
                            'side': side, 'index': idx,
                            'hero_id': top[0], 'name': bank.name.get(top[0], top[0]),
                            'score': round(top[1], 4), 'gap': round(gap, 4),
                            'confident': gap >= CONFIDENT_GAP,
                            'pos': [cx, cy, r], 'empty': False,
                        })

                    # ---- 质量校验：只拦截「明显异常」的误触发（空 ban 不参与）----
                    named = [p for p in picks if not p['empty']]
                    max_score = max(top_scores) if top_scores else 0.0
                    confident_n = sum(1 for p in named if p['confident'])
                    unique_n = len({p['hero_id'] for p in named})
                    if (not named) or unique_n <= 1 or max_score < 0.006:
                        print('[跳过] 疑似非 BP 界面（最高分 %.4f，高置信 %d/%d，唯一英雄 %d），5 秒后重试'
                              % (max_score, confident_n, len(named), unique_n))
                        time.sleep(5)
                        continue

                    # 输出（空 ban 显示 (空)）
                    lines = []
                    lines.append('===== BP 识别结果  %s =====' % datetime.now().strftime('%H:%M:%S'))
                    for side, title in [('blue', '我方（蓝）'), ('red', '敌方（红）')]:
                        items = [p for p in picks if p['side'] == side]
                        parts = ['(空)' if p['empty'] else '%s%s' % (p['name'], '' if p['confident'] else '?')
                                 for p in items]
                        lines.append('%s: %s' % (title, ' / '.join(parts)))
                    uncertain = [p for p in named if not p['confident']]
                    if uncertain:
                        lines.append('（带 ? = 低置信度，建议核对: %s）' %
                                     ', '.join('%s%s' % (p['side'][0].upper() + str(p['index']), p['name']) for p in uncertain))
                    out = '\n'.join(lines)
                    print('\n' + out + '\n')
                    write_result(out)

                    # 采集样本（空 ban 位不保存）
                    if not args.no_sample:
                        stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                        d = os.path.join(OUT_SAMPLES, stamp)
                        os.makedirs(d, exist_ok=True)
                        meta = []
                        for p in picks:
                            if p['empty']:
                                continue
                            cx, cy, r = p['pos']
                            av = crop_avatar(img, cx, cy, r)
                            fn = '%s_%02d_%s.jpg' % (p['side'], p['index'], p['hero_id'])
                            cv2.imwrite(os.path.join(d, fn), av, [cv2.IMWRITE_JPEG_QUALITY, 92])
                            meta.append({'file': fn, 'hero_id': p['hero_id'],
                                         'confident': p['confident'], 'gap': p['gap']})
                        json.dump(meta, open(os.path.join(d, 'meta.json'), 'w', encoding='utf-8'),
                                  ensure_ascii=False, indent=2)
                        print('[采集] 已保存 %d 张样本到 %s/（低置信度 %d 张，空ban %d）' % (
                            len(meta), d, len(uncertain),
                            sum(1 for p in picks if p['empty'])))

                    recognized = True
                    runs += 1
                    print('[识别] 本轮耗时 %.2f 秒' % (time.time() - t1))
                    if args.once:
                        break
            else:
                silent += 1
                stable = 0
                if state == 'IN_BP' and silent >= 3:
                    state = 'IDLE'
                    recognized = False
                    print('[检测] 离开 BP 界面，继续监听...')

            if args.once:
                print('（--once 模式，结束）')
                break
            time.sleep(args.interval)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print('[!] 异常: %s（2 秒后重试）' % e)
            time.sleep(2)

    print('\n已退出。本次识别 %d 轮，样本目录: %s' % (runs, OUT_SAMPLES))
    return 0


if __name__ == '__main__':
    sys.exit(main())
