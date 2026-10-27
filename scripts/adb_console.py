# -*- coding: utf-8 -*-
"""
ADB 接入控制台（图形界面）
=========================================
一站式：设备检测 → 投屏 → 自动识别 → 实时结果 → 样本采集

运行：双击「ADB控制台.bat」，或 python scripts/adb_console.py
"""
import os
import queue
import subprocess
import sys
import threading
import time
import json
from datetime import datetime

import tkinter as tk
from tkinter import ttk, scrolledtext

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ADB = r'D:\scrcpy\adb.exe'
SCRCPY = r'D:\scrcpy\scrcpy.exe'

# Windows 下隐藏子进程控制台窗口（否则每次抓帧都弹黑色 cmd 窗口）
CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0


def _run(cmd, **kwargs):
    """运行子进程并隐藏窗口（Windows）。"""
    kwargs.setdefault('creationflags', CREATE_NO_WINDOW)
    return subprocess.run(cmd, **kwargs)


# 延迟导入重模块（加速窗口出现）
R = None
LR = None


def load_modules():
    global R, LR
    if R is None:
        import recognize_screenshot as _R
        import live_recognize as _LR
        R, LR = _R, _LR


class App:
    def __init__(self, root):
        self.root = root
        root.title('王者BP助手 · ADB 接入控制台')
        root.geometry('880x720')
        root.minsize(760, 600)

        self.devices = []
        self.serial = None
        self.mirror_proc = None
        self.recog_thread = None
        self.recog_stop = threading.Event()
        self.bank = None
        self.sample_count = 0
        self.result_queue = queue.Queue()

        self._build_ui()
        self._poll_queue()
        self.refresh_devices()

    # ---------------- UI ----------------
    def _build_ui(self):
        pad = {'padx': 8, 'pady': 6}

        # 1. 设备区
        f1 = ttk.LabelFrame(self.root, text='① 设备接入')
        f1.pack(fill='x', **pad)

        row = tk.Frame(f1)
        row.pack(fill='x', padx=8, pady=6)
        tk.Label(row, text='设备:').pack(side='left')
        self.dev_combo = ttk.Combobox(row, state='readonly', width=42)
        self.dev_combo.pack(side='left', padx=6)
        ttk.Button(row, text='刷新', width=8, command=self.refresh_devices).pack(side='left')
        ttk.Button(row, text='连接选中', width=10, command=self.connect_device).pack(side='left', padx=4)

        # 无线调试（方式 A：USB 桥接）
        wf = ttk.LabelFrame(f1, text='无线调试（WiFi）')
        wf.pack(fill='x', padx=8, pady=(0, 6))
        row2 = tk.Frame(wf)
        row2.pack(fill='x', padx=6, pady=5)
        tk.Label(row2, text='手机IP:').pack(side='left')
        self.ip_entry = ttk.Entry(row2, width=18)
        self.ip_entry.pack(side='left', padx=4)
        ttk.Button(row2, text='获取IP', width=8, command=self.get_phone_ip).pack(side='left')
        ttk.Button(row2, text='①开启无线(需USB先连)', width=22,
                   command=self.enable_tcpip).pack(side='left', padx=4)
        ttk.Button(row2, text='②无线连接', width=10, command=self.connect_wireless).pack(side='left')
        ttk.Button(row2, text='断开', width=6, command=self.disconnect_device).pack(side='left', padx=4)

        # 无线调试（方式 B：Android 11+ 配对码）
        row2b = tk.Frame(wf)
        row2b.pack(fill='x', padx=6, pady=(0, 6))
        tk.Label(row2b, text='Android11+配对: 端口').pack(side='left')
        self.pair_port = ttk.Entry(row2b, width=8)
        self.pair_port.pack(side='left', padx=3)
        tk.Label(row2b, text='配对码').pack(side='left')
        self.pair_code = ttk.Entry(row2b, width=10)
        self.pair_code.pack(side='left', padx=3)
        ttk.Button(row2b, text='配对', width=8, command=self.pair_wireless).pack(side='left', padx=4)
        tk.Label(row2b, text='（手机→开发者选项→无线调试→使用配对码配对）',
                 fg='#888', font=('Microsoft YaHei', 8)).pack(side='left', padx=4)

        self.status_var = tk.StringVar(value='未连接')
        self.status_label = tk.Label(f1, textvariable=self.status_var, anchor='w',
                                     fg='#c00', font=('Microsoft YaHei', 10, 'bold'))
        self.status_label.pack(fill='x', padx=10, pady=(0, 8))

        # 2. 操作区
        f2 = ttk.LabelFrame(self.root, text='② 投屏与识别')
        f2.pack(fill='x', **pad)

        row3 = tk.Frame(f2)
        row3.pack(fill='x', padx=8, pady=8)
        self.btn_mirror = ttk.Button(row3, text='▶ 启动投屏', width=14, command=self.start_mirror)
        self.btn_mirror.pack(side='left')
        self.btn_mirror_stop = ttk.Button(row3, text='■ 停止投屏', width=14, command=self.stop_mirror, state='disabled')
        self.btn_mirror_stop.pack(side='left', padx=6)

        self.btn_recog = ttk.Button(row3, text='▶ 启动识别', width=14, command=self.start_recognize)
        self.btn_recog.pack(side='left', padx=(20, 0))
        self.btn_recog_stop = ttk.Button(row3, text='■ 停止识别', width=14, command=self.stop_recognize, state='disabled')
        self.btn_recog_stop.pack(side='left', padx=6)

        row3b = tk.Frame(f2)
        row3b.pack(fill='x', padx=8, pady=(0, 8))
        ttk.Button(row3b, text='🎯 立即识别', width=14,
                   command=self.manual_recognize).pack(side='left')
        ttk.Button(row3b, text='📷 诊断当前画面', width=16,
                   command=self.diagnose_frame).pack(side='left', padx=6)
        tk.Label(row3b, text='（BP 完成后点「立即识别」；诊断用于调参）',
                 fg='#888', font=('Microsoft YaHei', 8)).pack(side='left', padx=6)

        self.sample_var = tk.StringVar(value='样本: 0 局')
        tk.Label(row3b, textvariable=self.sample_var, fg='#080').pack(side='right')

        # 3. 识别结果
        f3 = ttk.LabelFrame(self.root, text='③ 识别结果')
        f3.pack(fill='both', expand=True, **pad)
        self.result_box = scrolledtext.ScrolledText(f3, height=10, wrap='word',
                                                    font=('Consolas', 11))
        self.result_box.pack(fill='both', expand=True, padx=8, pady=8)
        self.result_box.tag_config('title', foreground='#0066cc', font=('Microsoft YaHei', 11, 'bold'))
        self.result_box.tag_config('low', foreground='#cc6600')

        # 4. 日志
        f4 = ttk.LabelFrame(self.root, text='④ 运行日志')
        f4.pack(fill='both', expand=False, **pad)
        self.log_box = scrolledtext.ScrolledText(f4, height=7, wrap='word',
                                                 font=('Consolas', 9), state='disabled')
        self.log_box.pack(fill='both', expand=True, padx=8, pady=6)

    # ---------------- 工具 ----------------
    def log(self, msg):
        self.result_queue.put(('log', msg))

    def show_result(self, text, low_items):
        self.result_queue.put(('result', (text, low_items)))

    def _poll_queue(self):
        try:
            while True:
                kind, data = self.result_queue.get_nowait()
                if kind == 'log':
                    self.log_box.configure(state='normal')
                    self.log_box.insert('end', '[%s] %s\n' % (datetime.now().strftime('%H:%M:%S'), data))
                    self.log_box.see('end')
                    self.log_box.configure(state='disabled')
                elif kind == 'result':
                    text, low = data
                    self.result_box.insert('end', '\n' + text + '\n', 'title')
                    if low:
                        self.result_box.insert('end', '  ⚠ 低置信度: %s\n' % low, 'low')
                    self.result_box.see('end')
                elif kind == 'samples':
                    self.sample_count += 1
                    self.sample_var.set('样本: %d 局' % self.sample_count)
                elif kind == 'recog_done':
                    self.btn_recog.configure(state='normal')
                    self.btn_recog_stop.configure(state='disabled')
        except queue.Empty:
            pass
        self.root.after(200, self._poll_queue)

    # ---------------- 设备 ----------------
    def refresh_devices(self):
        self.devices = []
        self.dev_combo['values'] = []
        try:
            r = _run([ADB, 'devices'], capture_output=True,
                               encoding='utf-8', errors='replace', timeout=15)
            for line in (r.stdout or '').splitlines():
                p = line.strip().split()
                if len(p) >= 2 and not line.startswith('List of devices'):
                    self.devices.append((p[0], p[1]))
        except Exception as e:
            self.log('adb 失败: %s' % e)
            return

        if not self.devices:
            self.status_var.set('未检测到设备（请连数据线 + 开 USB 调试）')
            self.status_label.configure(fg='#c00')
            self.log('未检测到设备')
            return

        # 优先真机
        ready = [s for s, st in self.devices if st == 'device']
        real = [s for s in ready if not s.startswith('127.0.0.1') and not s.startswith('emulator-')]
        labels = []
        for s, st in self.devices:
            tag = '真机' if s in real else ('模拟器' if st == 'device' else st)
            labels.append('%s  [%s]' % (s, tag))
        self.dev_combo['values'] = labels
        pick = real or ready
        if pick:
            idx = [s for s, _ in self.devices].index(pick[0])
            self.dev_combo.current(idx)
            self.serial = pick[0]
            self._update_status(pick[0], real)
        self.log('刷新设备: %d 个' % len(self.devices))

    def _update_status(self, serial, real_list):
        try:
            model = _run([ADB, '-s', serial, 'shell', 'getprop', 'ro.product.model'],
                                   capture_output=True, encoding='utf-8', errors='replace', timeout=10).stdout.strip()
            size = _run([ADB, '-s', serial, 'shell', 'wm', 'size'],
                                  capture_output=True, encoding='utf-8', errors='replace', timeout=10).stdout.strip()
            tag = '真机' if serial in real_list else '模拟器'
            self.status_var.set('已连接: %s  %s  %s  [%s]' % (model or '-', size or '-', serial, tag))
            self.status_label.configure(fg='#080')
        except Exception as e:
            self.status_var.set('已连接: %s（信息读取失败 %s）' % (serial, e))

    def connect_device(self):
        idx = self.dev_combo.current()
        if idx < 0:
            self.log('请先下拉选择一个设备')
            return
        serial, state = self.devices[idx]
        self.serial = serial
        if state == 'device':
            self._update_status(serial, [])
            self.log('已选中设备 %s' % serial)
        else:
            self.log('设备 %s 状态为 %s：请检查 USB 调试授权' % (serial, state))

    def _is_emulator(self, serial=None):
        s = serial or self.serial or ''
        return s.startswith('127.0.0.1') or s.startswith('emulator-')

    def get_phone_ip(self):
        """从当前设备读取 WiFi IP（需真机已通过 USB 连上）。"""
        if not self.serial:
            self.log('请先连接设备（USB）')
            return
        if self._is_emulator():
            self.log('⚠ 当前设备 %s 是模拟器：它的 10.0.2.x 是模拟器内部地址，电脑无法直连；'
                     '而且模拟器本来就在本机，不需要无线调试。请连接真机后重试。' % self.serial)
            return
        import re
        probes = [
            ['shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0'],
            ['shell', 'ip', 'route'],
            ['shell', 'getprop', 'dhcp.wlan0.ipaddress'],
        ]
        for c in probes:
            try:
                r = _run([ADB, '-s', self.serial] + c, capture_output=True,
                                   encoding='utf-8', errors='replace', timeout=10)
                out = r.stdout or ''
                m = (re.search(r'inet\s+(\d+\.\d+\.\d+\.\d+)', out)
                     or re.search(r'src\s+(\d+\.\d+\.\d+\.\d+)', out)
                     or re.search(r'(\d+\.\d+\.\d+\.\d+)/\d+', out)
                     or re.search(r'^(\d+\.\d+\.\d+\.\d+)$', out.strip()))
                if m:
                    ip = m.group(1)
                    if ip.startswith('127.') or ip.startswith('10.0.2.'):
                        continue
                    self.ip_entry.delete(0, 'end')
                    self.ip_entry.insert(0, ip)
                    self.log('手机 WiFi IP: %s' % ip)
                    return
            except Exception:
                continue
        self.log('未获取到可用 WiFi IP（请确认手机已连 WiFi、且不是模拟器）')

    def enable_tcpip(self):
        """USB 连接状态下切换 adb 到 TCP/IP 模式（端口 5555）。"""
        if not self.serial:
            self.log('请先用 USB 连接手机（需授权 USB 调试）')
            return
        if self._is_emulator():
            self.log('⚠ 当前是模拟器（%s），模拟器就在本机，不需要无线调试' % self.serial)
            return
        if ':' in self.serial:
            self.log('当前已是网络设备，无需开启')
            return
        try:
            r = _run([ADB, '-s', self.serial, 'tcpip', '5555'],
                               capture_output=True, encoding='utf-8', errors='replace', timeout=20)
            self.log('开启无线模式: %s' % ((r.stdout or r.stderr or '').strip() or '已发送'))
            self.log('下一步：点「获取IP」→「②无线连接」→ 之后可拔掉数据线')
        except Exception as e:
            self.log('开启失败: %s' % e)

    def connect_wireless(self):
        ip = self.ip_entry.get().strip()
        if not ip:
            self.log('请先填手机 IP（可点「获取IP」自动填）')
            return
        if ip.startswith('10.0.2.') or ip.startswith('127.'):
            self.log('⚠ %s 是模拟器内部地址，电脑无法连接。请：\n'
                     '   1) 数据线连真机（USB 调试授权）\n'
                     '   2) 选下拉框里的真机设备\n'
                     '   3) 点「① 开启无线」→「获取IP」→「② 无线连接」' % ip)
            return
        addr = ip if ':' in ip else ip + ':5555'
        try:
            r = _run([ADB, 'connect', addr], capture_output=True,
                               encoding='utf-8', errors='replace', timeout=12)
            msg = (r.stdout or r.stderr or '').strip()
            self.log('无线连接 %s → %s' % (addr, msg))
        except subprocess.TimeoutExpired:
            self.log('无线连接 %s 超时（12秒）。常见原因：\n'
                     '   · 手机和电脑不在同一 WiFi\n'
                     '   · 手机没执行过「① 开启无线」（adb tcpip 5555）\n'
                     '   · 路由器开了 AP 隔离\n'
                     '   · IP 填错（请点「获取IP」自动填）' % addr)
            return
        except Exception as e:
            self.log('无线连接失败: %s' % e)
            return
        self.refresh_devices()
        for i, (s, st) in enumerate(self.devices):
            if addr in s:
                self.dev_combo.current(i)
                self.serial = s
                self._update_status(s, [])
                self.log('已切换到无线设备 %s，现在可以拔掉数据线' % s)
                break

    def pair_wireless(self):
        """Android 11+ 无线调试配对（完全不用 USB）。"""
        ip = self.ip_entry.get().strip()
        port = self.pair_port.get().strip()
        code = self.pair_code.get().strip()
        if not ip or not port or not code:
            self.log('请填：手机IP / 配对端口 / 配对码（手机「无线调试→使用配对码配对设备」里显示）')
            return
        try:
            r = _run([ADB, 'pair', '%s:%s' % (ip, port), code],
                               capture_output=True, encoding='utf-8', errors='replace', timeout=30)
            msg = (r.stdout or r.stderr or '').strip()
            self.log('配对 %s:%s → %s' % (ip, port, msg or '无返回'))
            if 'Successfully' in msg:
                self.log('配对成功！接着在「无线调试」主页面找到连接端口，'
                         '把 IP:端口 填到手机IP框后点「②无线连接」')
        except Exception as e:
            self.log('配对失败: %s' % e)

    def disconnect_device(self):
        # 只有网络设备（含冒号地址）才需要 adb disconnect
        if self.serial and ':' in self.serial:
            _run([ADB, 'disconnect', self.serial], capture_output=True, timeout=10)
            self.log('已断开网络设备 %s' % self.serial)
        else:
            self.log('USB 设备请直接拔线（%s）' % self.serial)
        self.refresh_devices()

    # ---------------- 投屏 ----------------
    def start_mirror(self):
        if not self.serial:
            self.log('请先选择设备')
            return
        if self.mirror_proc and self.mirror_proc.poll() is None:
            self.log('投屏已在运行')
            return
        try:
            self.mirror_proc = subprocess.Popen(
                [SCRCPY, '-s', self.serial, '--no-audio', '--max-size=1920', '--stay-awake'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=CREATE_NO_WINDOW)
            self.log('投屏已启动（关闭该窗口即停止）')
            self.btn_mirror.configure(state='disabled')
            self.btn_mirror_stop.configure(state='normal')
        except Exception as e:
            self.log('投屏启动失败: %s' % e)

    def stop_mirror(self):
        if self.mirror_proc and self.mirror_proc.poll() is None:
            self.mirror_proc.terminate()
        self.mirror_proc = None
        self.btn_mirror.configure(state='normal')
        self.btn_mirror_stop.configure(state='disabled')
        self.log('投屏已停止')

    # ---------------- 识别 ----------------
    def start_recognize(self):
        if not self.serial:
            self.log('请先选择设备')
            return
        if self.recog_thread and self.recog_thread.is_alive():
            self.log('识别已在运行')
            return
        self.btn_recog.configure(state='disabled')
        self.btn_recog_stop.configure(state='normal')
        self.recog_stop.clear()
        self.recog_thread = threading.Thread(target=self._recog_loop, daemon=True)
        self.recog_thread.start()
        self.log('识别已启动（自动检测 BP）')

    def stop_recognize(self):
        self.recog_stop.set()
        self.log('正在停止识别...')

    def _get_bank(self):
        """懒加载并缓存特征库（避免每次识别都重新加载 ~0.5 秒）。"""
        if getattr(self, '_bank', None) is None:
            load_modules()
            self.log('加载英雄特征库...')
            self._bank = LR.FeatureBank()
            self.log('特征库就绪（%d 个）' % len(self._bank.ids))
        return self._bank

    def manual_recognize(self):
        """手动识别当前画面：点按钮立即执行，绕过自动检测的时机问题。"""
        if not self.serial:
            self.log('请先选择设备')
            return
        if getattr(self, '_manual_busy', False):
            self.log('上一次手动识别还在进行中...')
            return
        self._manual_busy = True

        def work():
            try:
                t0 = time.time()
                bank = self._get_bank()
                raw = LR.capture(ADB, self.serial)
                img = LR.normalize(raw)
                bp = LR.detect_bp(img)
                if not bp['is_bp']:
                    self.log('⚠ 自动判定非 BP 界面（左%d 右%d 锁%d V=%.0f），仍强制识别' % (
                        len(bp['left']), len(bp['right']), bp['locks'], bp['top_v']))
                if len(bp['left']) < 2 or len(bp['right']) < 2:
                    self.log('✗ 未检测到 ban 位布局（左%d 右%d），识别取消' % (
                        len(bp['left']), len(bp['right'])))
                    return
                self.log('[手动识别] 抓帧 + 多帧融合中...')
                ok = self._do_recognize(img, bp, bank, force=True)
                self.log('[手动识别] %s，总耗时 %.2f 秒' % (
                    '完成' if ok else '未成功', time.time() - t0))
            except Exception as e:
                self.log('手动识别失败: %s' % e)
            finally:
                self._manual_busy = False

        threading.Thread(target=work, daemon=True).start()

    def diagnose_frame(self):
        """抓一帧，输出 BP 判定全过程参数 + 保存截图，用于调参。"""
        if not self.serial:
            self.log('请先选择设备')
            return

        def work():
            try:
                load_modules()
                import cv2
                raw = LR.capture(ADB, self.serial)
                img = LR.normalize(raw)
                H, W = img.shape[:2]
                left, right = R.detect_circles(img)
                l2 = R.validate_row(left)
                r2 = R.validate_row(right)
                locks = sum(1 for c in (l2 + r2) if R.has_lock(img, *c))
                top_v = LR._top_brightness(img)
                bp = LR.detect_bp(img)

                os.makedirs('_diag', exist_ok=True)
                fn = '_diag/diag_%s.jpg' % datetime.now().strftime('%H%M%S')
                cv2.imwrite(fn, img, [cv2.IMWRITE_JPEG_QUALITY, 95])

                self.log('========== 诊断 ==========')
                self.log('  画面尺寸: %dx%d' % (W, H))
                self.log('  原始圆:   左%d 右%d' % (len(left), len(right)))
                self.log('  校验后:   左%d 右%d' % (len(l2), len(r2)))
                self.log('  半径:     %s' % ([c[2] for c in l2 + r2][:12]))
                self.log('  锁数量:   %d' % locks)
                self.log('  顶部亮度: %.1f' % top_v)
                self.log('  等距:     左%s 右%s' % (
                    '✓' if LR._evenly_spaced(l2) else '✗',
                    '✓' if LR._evenly_spaced(r2) else '✗'))
                self.log('  is_bp:    %s   (需 布局+等距 且 锁>=3或V<130)' % bp['is_bp'])
                self.log('  截图:     %s' % fn)

                if bp['is_bp']:
                    bank = LR.FeatureBank()
                    self.log('  ---- 识别分数（最高分 / 分差）----')
                    allc = list(l2) + list(r2)
                    for j, (cx, cy, r) in enumerate(allc):
                        fused = bank.fuse([bank.ranks(LR.crop_avatar(img, cx, cy, r))])
                        gap = fused[0][1] - (fused[1][1] if len(fused) > 1 else 0)
                        self.log('    位%-2d %-10s 分=%.4f 差=%.4f %s' % (
                            j + 1, bank.name.get(fused[0][0], fused[0][0]),
                            fused[0][1], gap, '可信' if gap >= LR.CONFIDENT_GAP else '低'))
                else:
                    self.log('  → 判定不是 BP 界面，不会触发识别')
                self.log('==========================')
            except Exception as e:
                self.log('诊断失败: %s' % e)

        threading.Thread(target=work, daemon=True).start()

    def _recog_loop(self):
        try:
            load_modules()
            bank = self._get_bank()

            state, stable, recognized, silent = 'IDLE', 0, False, 0
            self._last_attempt = 0.0
            while not self.recog_stop.is_set():
                try:
                    raw = LR.capture(ADB, self.serial)
                    img = LR.normalize(raw)
                    bp = LR.detect_bp(img)

                    if bp['is_bp']:
                        stable += 1
                        silent = 0
                        if state != 'IN_BP':
                            state = 'IN_BP'
                            self.log('进入 BP 界面（左%d 右%d 锁%d 顶部V=%.0f）' % (
                                len(bp['left']), len(bp['right']), bp['locks'], bp['top_v']))
                        # 5 秒冷却：误触发时不会每秒刷屏，真 BP 时也不会错过
                        if stable >= 2 and not recognized and (time.time() - self._last_attempt) > 5:
                            self._last_attempt = time.time()
                            recognized = self._do_recognize(img, bp, bank)
                    else:
                        silent += 1
                        stable = 0
                        if state == 'IN_BP' and silent >= 3:
                            state = 'IDLE'
                            recognized = False
                            self.log('离开 BP 界面，继续监听')
                except Exception as e:
                    import traceback
                    tb = traceback.format_exc().strip().splitlines()
                    loc = next((l.strip() for l in reversed(tb) if 'line ' in l), '')
                    self.log('抓帧异常: %s  [%s]' % (e, loc))
                    time.sleep(2)
                for _ in range(10):
                    if self.recog_stop.is_set():
                        break
                    time.sleep(0.1)
        finally:
            self.result_queue.put(('recog_done', None))
            self.log('识别已停止')

    def _do_recognize(self, img, bp, bank, force=False):
        """识别核心。force=True 时跳过高置信度质量校验（手动点按钮时用）。"""
        t0 = time.time()
        frames = [img]
        for _ in range(2):
            try:
                frames.append(LR.normalize(LR.capture(ADB, self.serial)))
            except Exception:
                pass
        left, right = bp['left'], bp['right']
        allc = list(left) + list(right)
        # 锁检测：新 UI 有锁系统时，无锁位 = 空 ban（该位没有英雄被 ban）
        has_locks = [R.has_lock(img, cx, cy, r) for (cx, cy, r) in allc]
        use_lock = sum(has_locks) >= 2

        picks = []
        top_scores = []
        for j, (cx, cy, r) in enumerate(allc):
            side = 'blue' if j < len(left) else 'red'
            idx = (j if j < len(left) else j - len(left)) + 1
            if use_lock and not has_locks[j]:
                # 空 ban 位：直接标记，不做识别（否则会匹配到字典第一个英雄）
                picks.append({
                    'side': side, 'index': idx,
                    'hero_id': None, 'name': None,
                    'gap': 0.0, 'confident': True,
                    'pos': [cx, cy, r], 'empty': True,
                })
                continue
            pairs = [bank.ranks(LR.crop_avatar(f, cx, cy, r)) for f in frames]
            fused = bank.fuse(pairs)
            top = fused[0]
            second = fused[1] if len(fused) > 1 else (None, 0)
            gap = top[1] - second[1]
            top_scores.append(top[1])
            picks.append({
                'side': side, 'index': idx,
                'hero_id': top[0], 'name': bank.name.get(top[0], top[0]),
                'gap': round(gap, 4), 'confident': gap >= LR.CONFIDENT_GAP,
                'pos': [cx, cy, r], 'empty': False,
            })

        # ---- 质量校验：只拦截「明显异常」的误触发（空 ban 位不参与） ----
        named = [p for p in picks if not p['empty']]
        max_score = max(top_scores) if top_scores else 0.0
        confident_n = sum(1 for p in named if p['confident'])
        unique_n = len({p['hero_id'] for p in named})
        if (not force) and ((not named) or unique_n <= 1 or max_score < 0.006):
            self.log('⚠ 疑似非 BP 界面（最高分 %.4f，高置信 %d/%d，唯一英雄 %d），跳过' % (
                max_score, confident_n, len(named), unique_n))
            return False

        # 输出（空 ban 显示为 (空)）
        lines = ['===== %s =====' % datetime.now().strftime('%H:%M:%S')]
        lows = []
        for side, title in [('blue', '我方（蓝）'), ('red', '敌方（红）')]:
            items = [p for p in picks if p['side'] == side]
            parts = []
            for p in items:
                if p['empty']:
                    parts.append('(空)')
                else:
                    parts.append('%s%s' % (p['name'], '' if p['confident'] else '?'))
            lines.append('%s: %s' % (title, ' / '.join(parts)))
        for p in named:
            if not p['confident']:
                lows.append('%s %s' % (p['side'][0].upper() + str(p['index']), p['name']))
        self.show_result('\n'.join(lines), ', '.join(lows))

        # 保存样本（空 ban 位不保存）
        try:
            import cv2
            stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            d = os.path.join(LR.OUT_SAMPLES, stamp)
            os.makedirs(d, exist_ok=True)
            meta = []
            for p in picks:
                if p['empty']:
                    continue
                cx, cy, r = p['pos']
                av = LR.crop_avatar(img, cx, cy, r)
                fn = '%s_%02d_%s.jpg' % (p['side'], p['index'], p['hero_id'])
                cv2.imwrite(os.path.join(d, fn), av, [cv2.IMWRITE_JPEG_QUALITY, 92])
                meta.append({'file': fn, 'hero_id': p['hero_id'],
                             'confident': p['confident'], 'gap': p['gap']})
            json.dump(meta, open(os.path.join(d, 'meta.json'), 'w', encoding='utf-8'),
                      ensure_ascii=False, indent=2)
            self.result_queue.put(('samples', None))
            self.log('已保存 %d 张样本（低置信 %d，空ban %d）→ %s' % (
                len(meta), len(lows), sum(1 for p in picks if p['empty']), d))
        except Exception as e:
            self.log('保存样本失败: %s' % e)

        self.log('本轮识别耗时 %.2f 秒' % (time.time() - t0))
        return True


def main():
    root = tk.Tk()
    app = App(root)

    def on_close():
        app.recog_stop.set()
        if app.mirror_proc and app.mirror_proc.poll() is None:
            app.mirror_proc.terminate()
        root.destroy()

    root.protocol('WM_DELETE_WINDOW', on_close)
    root.mainloop()


if __name__ == '__main__':
    main()
