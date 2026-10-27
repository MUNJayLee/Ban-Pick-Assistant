# -*- coding: utf-8 -*-
"""
实时 BP 识别（阶段 + ban）
=========================================
步骤一实现：ADB 抓屏 → OCR 阶段识别 → ban 位识别 → 终端输出

用法：
  python scripts/live_bp.py               # 常驻监听
  python scripts/live_bp.py --once        # 只检测一次
  python scripts/live_bp.py --interval 2  # 轮询间隔（秒）
  python scripts/live_bp.py --frames       # 从本地截图目录模拟（调试用）

退出：Ctrl+C
"""
import argparse
import os
import subprocess
import sys
import time
from datetime import datetime

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recognize_screenshot as R
from live_recognize import (
    FeatureBank, detect_phase, detect_bp, crop_avatar,
    recognize_bans, format_bans,
    CONFIDENT_GAP, _run, CREATE_NO_WINDOW, DEFAULT_ADB, TARGET_WIDTH,
)


# ---------------------------------------------------------------------------
# 抓屏
# ---------------------------------------------------------------------------
def find_adb(explicit=None):
    for c in ([explicit] if explicit else []) + [DEFAULT_ADB, 'adb']:
        try:
            r = _run([c, 'version'], capture_output=True, encoding='utf-8',
                     errors='replace', timeout=8)
            if r.returncode == 0 and 'Android Debug Bridge' in (r.stdout or ''):
                return c
        except Exception:
            continue
    return None


def list_devices(adb):
    r = _run([adb, 'devices'], capture_output=True, encoding='utf-8',
             errors='replace', timeout=15)
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
# 主流程
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--adb-path', default=None)
    ap.add_argument('--serial', default=None)
    ap.add_argument('--once', action='store_true')
    ap.add_argument('--interval', type=float, default=2.0, help='轮询间隔秒')
    ap.add_argument('--frames', default=None, help='本地截图目录（调试用）')
    args = ap.parse_args()

    print('=' * 62)
    print('  实时 BP 识别 · 步骤一（阶段 + ban）')
    print('=' * 62)

    # 加载特征库
    print('[1] 加载英雄特征库...')
    t0 = time.time()
    bank = FeatureBank()
    print('    完成：%d 个英雄，耗时 %.2f 秒' % (len(bank.ids), time.time() - t0))

    # 设备（或本地截图模式）
    adb = serial = None
    if args.frames:
        files = sorted(f for f in os.listdir(args.frames)
                       if f.lower().endswith(('.jpg', '.png')))
        print('[2] 本地截图模式：%d 张' % len(files))
    else:
        adb = find_adb(args.adb_path)
        if not adb:
            print('[X] 未找到 adb')
            return 1
        devices = list_devices(adb)
        if not devices:
            print('[X] 没有设备')
            return 2
        ready = [s for s, st in devices if st == 'device']
        real = [s for s in ready if not s.startswith('127.0.0.1') and not s.startswith('emulator-')]
        serial = args.serial or (real[0] if real else (ready[0] if ready else None))
        print('[2] 设备: %s' % serial)

    print('[3] 开始监听（每 %.1f 秒一帧）...\n' % args.interval)
    prev_phase = None
    prev_bans = []
    idx = 0
    while True:
        try:
            # 取帧
            if args.frames:
                if idx >= len(files):
                    break
                path = os.path.join(args.frames, files[idx])
                img = R.imread_unicode(path)
                idx += 1
            else:
                img = normalize(capture(adb, serial))

            if img is None:
                time.sleep(1)
                continue

            # 阶段识别
            t1 = time.time()
            phase, score = detect_phase(img)
            dt_phase = time.time() - t1

            if phase != prev_phase:
                print('[%s] 阶段: %s (OCR %.1fs)' % (
                    datetime.now().strftime('%H:%M:%S'), phase, dt_phase))
                prev_phase = phase

            # ban 阶段 → 识别 ban
            if phase == 'ban':
                bans = recognize_bans(img, bank)
                key = tuple((b['side'], b['hero_id']) for b in bans)
                if key != prev_bans:
                    prev_bans = key
                    print('[%s] %s' % (datetime.now().strftime('%H:%M:%S'),
                                       format_bans(bans)))
            elif phase == 'final':
                print('[%s] BP 完成（最后调整阶段）' % datetime.now().strftime('%H:%M:%S'))
            elif phase == 'pick':
                # pick 识别留待步骤二
                pass

            if args.once and not args.frames:
                break
            time.sleep(args.interval)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print('[!] 异常: %s' % e)
            time.sleep(2)

    print('\n已退出')
    return 0


if __name__ == '__main__':
    sys.exit(main())
