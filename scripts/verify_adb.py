# -*- coding: utf-8 -*-
"""
ADB 抓屏验证脚本（投屏识别方案 · 阶段 1）
=========================================
目的：验证「ADB 抓屏 → 现有识别管线」这条路是否成立。

用法：
  python scripts/verify_adb.py                  # 抓一帧并识别
  python scripts/verify_adb.py --frames 5       # 连续抓 5 帧，测性能 + 逐帧识别
  python scripts/verify_adb.py --keep           # 保留原始截图到 _adb_capture/
  python scripts/verify_adb.py --no-color       # 用纯 ORB 模式对比（更稳但上限低）

流程：
  1. 定位 adb（--adb-path > D:\\scrcpy\\adb.exe > PATH 中的 adb）
  2. 检查设备连接（处理 offline / unauthorized）
  3. adb exec-out screencap -p 抓原始 PNG
  4. 归一化到 1920 宽（与现有识别管线的假设一致）
  5. 调 scripts/recognize_screenshot.py 识别（与线上完全一致）
  6. 同时跑 detect_circles，检查 BP 布局特征（全自动检测的基础）

输出：每帧的识别结果 + 耗时 + 布局检测情况。
"""
import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recognize_screenshot as R

TARGET_WIDTH = 1920          # 现有识别管线的基准宽度
DEFAULT_ADB = r'D:\scrcpy\adb.exe'
OUT_DIR = '_adb_capture'


# ---------------------------------------------------------------------------
# ADB 工具
# ---------------------------------------------------------------------------
def find_adb(explicit=None):
    """按 显式参数 > D:\\scrcpy\\adb.exe > PATH 顺序找 adb。"""
    candidates = []
    if explicit:
        candidates.append(explicit)
    candidates.append(DEFAULT_ADB)
    candidates.append('adb')
    for c in candidates:
        try:
            r = subprocess.run([c, 'version'], capture_output=True,
                               encoding='utf-8', errors='replace', timeout=10)
            if r.returncode == 0 and 'Android Debug Bridge' in (r.stdout or ''):
                return c, (r.stdout or '').splitlines()[0]
        except Exception:
            continue
    return None, None


def list_devices(adb):
    """返回 [(serial, state)]，state 常见值：device / unauthorized / offline。"""
    r = subprocess.run([adb, 'devices'], capture_output=True,
                       encoding='utf-8', errors='replace', timeout=15)
    out = []
    for line in (r.stdout or '').splitlines():
        line = line.strip()
        if not line or line.startswith('List of devices'):
            continue
        parts = line.split()
        if len(parts) >= 2:
            out.append((parts[0], parts[1]))
    return out


def pick_device(devices, serial=None):
    if serial:
        for s, st in devices:
            if s == serial:
                return s, st
        return None, 'not-found'
    # 优先取 device 状态的；否则返回第一个
    for s, st in devices:
        if st == 'device':
            return s, st
    return (devices[0] if devices else (None, 'none'))


def capture_png(adb, serial=None, timeout=30):
    """用 exec-out 抓原始 PNG（二进制，避免 Windows 换行转换）。"""
    cmd = [adb]
    if serial:
        cmd += ['-s', serial]
    cmd += ['exec-out', 'screencap', '-p']
    t0 = time.time()
    r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    elapsed = time.time() - t0
    data = r.stdout or b''
    # PNG 完整性校验 + 修复（Windows 管道可能把 \n 转成 \r\n）
    if not data.startswith(b'\x89PNG'):
        data = r.stdout.replace(b'\r\n', b'\n')
    if not data.startswith(b'\x89PNG'):
        raise RuntimeError('抓屏返回的不是 PNG（长度 %d，头部 %r）' % (len(data), data[:16]))
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError('PNG 解码失败（长度 %d）' % len(data))
    return img, elapsed, data


def normalize(img):
    """归一化到 1920 宽（保持宽高比）——现有识别管线的基准。"""
    h, w = img.shape[:2]
    if w == TARGET_WIDTH:
        return img, False
    scale = TARGET_WIDTH / float(w)
    return cv2.resize(img, (TARGET_WIDTH, int(round(h * scale))), interpolation=cv2.INTER_AREA), True


# ---------------------------------------------------------------------------
# 识别（调线上同一个脚本，保证一致）
# ---------------------------------------------------------------------------
def recognize_file(path):
    r = subprocess.run([sys.executable, 'scripts/recognize_screenshot.py', path],
                       capture_output=True, encoding='utf-8', errors='replace')
    try:
        return json.loads(r.stdout)
    except Exception:
        return {'error': (r.stdout or '')[:200] + (r.stderr or '')[:200]}


def check_bp_layout(img):
    """复用 detect_circles 检查 BP 布局（全自动检测的基础）。"""
    left, right = R.detect_circles(img)
    left = R.validate_row(left)
    right = R.validate_row(right)
    locks = sum(1 for c in (left + right) if R.has_lock(img, *c))
    return {
        'left': len(left), 'right': len(right),
        'total': len(left) + len(right),
        'locks': locks,
        'is_bp_ready': len(left) >= 3 and len(right) >= 3,
    }


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--adb-path', default=None, help='adb.exe 路径')
    ap.add_argument('--serial', default=None, help='设备序列号（多设备时指定）')
    ap.add_argument('--frames', type=int, default=1, help='连续抓取帧数')
    ap.add_argument('--interval', type=float, default=1.0, help='帧间隔秒')
    ap.add_argument('--keep', action='store_true', help='保留截图到 _adb_capture/')
    ap.add_argument('--no-color', action='store_true', help='用纯 ORB 对比（设置 RECOGNIZE_ENGINE 环境变量无用，这里仅提示）')
    args = ap.parse_args()

    print('=' * 60)
    print('ADB 抓屏验证（阶段 1）')
    print('=' * 60)

    # 1. 找 adb
    adb, ver = find_adb(args.adb_path)
    if not adb:
        print('[X] 未找到 adb。')
        print('    已尝试: --adb-path / %s / PATH' % DEFAULT_ADB)
        print('    请确认 D:\\scrcpy\\adb.exe 存在，或用 --adb-path 指定。')
        return 1
    print('[1] adb: %s' % adb)
    print('    %s' % ver)

    # 2. 查设备
    devices = list_devices(adb)
    print('[2] 设备列表: %s' % (devices if devices else '（空）'))
    if not devices:
        print('[X] 没有检测到设备。请：')
        print('    1) 手机用数据线连电脑')
        print('    2) 打开「开发者选项 → USB 调试」')
        print('    3) 手机上点「允许 USB 调试」')
        print('    4) 重跑本脚本')
        return 2
    serial, state = pick_device(devices, args.serial)
    print('    使用设备: %s（状态: %s）' % (serial, state))
    if state != 'device':
        if state == 'unauthorized':
            print('[X] 设备未授权：请在手机上点「允许 USB 调试」后重试。')
        elif state == 'offline':
            print('[X] 设备 offline：尝试 adb kill-server && adb start-server，或重新插拔。')
        else:
            print('[X] 设备状态异常: %s' % state)
        return 3

    # 3. 抓帧
    os.makedirs(OUT_DIR, exist_ok=True)
    results = []
    for i in range(args.frames):
        if i > 0:
            time.sleep(args.interval)
        print('-' * 60)
        print('[帧 %d/%d] 抓屏...' % (i + 1, args.frames))
        try:
            raw, cap_elapsed, png = capture_png(adb, serial)
        except Exception as e:
            print('    [X] 抓屏失败: %s' % e)
            continue
        h, w = raw.shape[:2]
        print('    原始: %dx%d, 抓屏耗时 %.2f 秒' % (w, h, cap_elapsed))

        norm_img, resized = normalize(raw)
        print('    归一化: %dx%d%s' % (norm_img.shape[1], norm_img.shape[0],
                                      '（已缩放到 1920 宽）' if resized else '（原尺寸）'))

        # 保存（保留模式）
        if args.keep or True:
            raw_path = os.path.join(OUT_DIR, 'frame_%02d_raw.png' % (i + 1))
            norm_path = os.path.join(OUT_DIR, 'frame_%02d_norm.jpg' % (i + 1))
            with open(raw_path, 'wb') as f:
                f.write(png)
            cv2.imwrite(norm_path, norm_img, [cv2.IMWRITE_JPEG_QUALITY, 95])

        # 4. BP 布局检测
        try:
            layout = check_bp_layout(norm_img)
            print('    BP 布局: 左%d 右%d（共%d），检测到锁 %d 个 → %s' % (
                layout['left'], layout['right'], layout['total'], layout['locks'],
                '像 BP 界面' if layout['is_bp_ready'] else '不像 BP 界面'))
        except Exception as e:
            print('    BP 布局检测异常: %s' % e)

        # 5. 识别
        rec_elapsed = 0.0
        t0 = time.time()
        res = recognize_file(os.path.join(OUT_DIR, 'frame_%02d_norm.jpg' % (i + 1)))
        rec_elapsed = time.time() - t0
        if 'error' in res:
            print('    [X] 识别失败: %s' % res['error'])
        else:
            names = [r.get('name') or '(空)' for r in res.get('results', [])]
            print('    识别(耗时 %.2f 秒): %s' % (rec_elapsed, ' '.join(names)))
            results.append({'frame': i + 1, 'cap': cap_elapsed, 'rec': rec_elapsed,
                            'layout': layout, 'names': names})

    # 6. 汇总
    print('=' * 60)
    if results:
        caps = [r['cap'] for r in results]
        recs = [r['rec'] for r in results]
        print('汇总: %d 帧 | 抓屏平均 %.2fs | 识别平均 %.2fs | 单帧总耗时 %.2fs' % (
            len(results), sum(caps) / len(caps), sum(recs) / len(recs),
            sum(caps) / len(caps) + sum(recs) / len(recs)))
        print('截图已保存到 %s/' % OUT_DIR)
        print('')
        print('请人工核对识别结果是否正确。若准确率达标（≈8/9），ADB 路线成立，可进入阶段 2。')
    else:
        print('没有成功抓到任何帧。')
        return 4
    return 0


if __name__ == '__main__':
    sys.exit(main())
