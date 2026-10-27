# -*- coding: utf-8 -*-
"""
王者BP助手 v3.0 · 本地 API 服务
=========================================
为 Web 前端提供：ADB 设备管理 / 抓帧 / BP 阶段识别 / ban 识别 / 数据同步

启动：
  python scripts/api_server.py            # 默认 8900 端口
  python scripts/api_server.py --port 8901

API 文档：http://127.0.0.1:8900/docs
"""
import argparse
import asyncio
import base64
import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from typing import Optional

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import recognize_screenshot as R
from live_recognize import (
    FeatureBank, detect_phase, recognize_bans, recognize_picks, format_bans, normalize, detect_user_side,
    _run, CREATE_NO_WINDOW, DEFAULT_ADB, TARGET_WIDTH, CONFIDENT_GAP,
)

APP_VERSION = '3.0.0'

# ---------------------------------------------------------------------------
# 全局状态
# ---------------------------------------------------------------------------
_lock = threading.Lock()
_state = {
    'device': None,          # 当前设备 serial
    'phase': 'other',        # ban / pick / final / other
    'phase_score': 0.0,
    'bans': [],              # [{side,index,hero_id,name,score,gap,confident}]
    'user_side': None,       # 'BLUE' / 'RED' / None（我方阵营）
    'picks': [],             # [{side,index,hero_id,name,confident,empty}]
    'monitoring': False,
    'last_update': None,
    'error': None,
}
_bank: Optional[FeatureBank] = None
_bank_lock = threading.Lock()
_bp_thread: Optional[threading.Thread] = None
_bp_stop = threading.Event()
_ws_clients = set()
_loop: Optional[asyncio.AbstractEventLoop] = None

app = FastAPI(title='王者BP助手 v3.0 API', version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


# ---------------------------------------------------------------------------
# ADB 工具
# ---------------------------------------------------------------------------
def find_adb():
    for c in [DEFAULT_ADB, 'adb']:
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
            serial, st = p[0], p[1]
            is_real = not (serial.startswith('127.0.0.1') or serial.startswith('emulator-'))
            out.append({'serial': serial, 'state': st, 'is_real': is_real})
    return out


def capture(adb, serial):
    cmd = [adb] + (['-s', serial] if serial else []) + ['exec-out', 'screencap', '-p']
    r = _run(cmd, capture_output=True, timeout=30)
    data = r.stdout or b''
    if not data.startswith(b'\x89PNG'):
        data = data.replace(b'\r\n', b'\n')
    if not data.startswith(b'\x89PNG'):
        raise RuntimeError('抓屏不是 PNG（设备未连接或 adb 异常）')
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError('PNG 解码失败')
    return img


def get_bank():
    global _bank
    with _bank_lock:
        if _bank is None:
            _bank = FeatureBank()
        return _bank


# ---------------------------------------------------------------------------
# WebSocket 广播
# ---------------------------------------------------------------------------
def broadcast(payload: dict):
    """向所有 WebSocket 客户端推送（线程安全）。"""
    if _loop is None or not _ws_clients:
        return
    data = json.dumps(payload, ensure_ascii=False)
    async def _send():
        dead = []
        for ws in list(_ws_clients):
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            _ws_clients.discard(ws)
    try:
        asyncio.run_coroutine_threadsafe(_send(), _loop)
    except Exception:
        pass


def update_state(**kwargs):
    with _lock:
        _state.update(kwargs)
        _state['last_update'] = datetime.now().isoformat(timespec='seconds')
        snapshot = dict(_state)
    broadcast({'type': 'state', 'data': snapshot})


# ---------------------------------------------------------------------------
# BP 监听后台线程
# ---------------------------------------------------------------------------
def _bp_worker(interval=2.0):
    adb = find_adb()
    if not adb:
        update_state(error='未找到 adb', monitoring=False)
        return
    bank = get_bank()
    prev_phase = None
    prev_bans_key = None
    prev_picks_key = None
    while not _bp_stop.is_set():
        try:
            with _lock:
                serial = _state['device']
            if not serial:
                time.sleep(1)
                continue
            img_raw = capture(adb, serial)
            img = normalize(img_raw)

            phase, pscore = detect_phase(img)
            if phase != prev_phase:
                prev_phase = phase
                update_state(phase=phase, phase_score=round(pscore, 2), error=None)

            # 阵营识别（左侧框颜色）——只在 BP 界面才判断，避免其他游戏误判
            side = detect_user_side(img) if phase in ('ban', 'pick', 'final') else None
            with _lock:
                prev_side = _state['user_side']
            if side and side != prev_side:
                update_state(user_side=side)

            if phase == 'ban':
                bans = recognize_bans(img, bank)
                key = tuple((b['side'], b['hero_id']) for b in bans)
                if key != prev_bans_key:
                    prev_bans_key = key
                    update_state(bans=bans)
                    print('[%s] %s' % (datetime.now().strftime('%H:%M:%S'),
                                       format_bans(bans)))
                prev_picks_key = None
            elif phase in ('pick', 'final'):
                picks = recognize_picks(img, bank)
                pkey = tuple((x['side'], x['index'], x['hero_id']) for x in picks)
                if pkey != prev_picks_key:
                    prev_picks_key = pkey
                    update_state(picks=picks)
                    n_blue = sum(1 for x in picks if x['side'] == 'blue' and x['hero_id'])
                    n_red = sum(1 for x in picks if x['side'] == 'red' and x['hero_id'])
                    print('[%s] picks: 我方 %d / 敌方 %d' % (
                        datetime.now().strftime('%H:%M:%S'), n_blue, n_red))
                prev_bans_key = None
            else:
                prev_bans_key = None
                prev_picks_key = None
        except Exception as e:
            update_state(error=str(e))
            time.sleep(3)
        _bp_stop.wait(interval)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
class DeviceReq(BaseModel):
    serial: str


@app.get('/api/health')
def api_health():
    return {'ok': True, 'version': APP_VERSION, 'time': datetime.now().isoformat(timespec='seconds')}


@app.get('/api/devices')
def api_devices():
    adb = find_adb()
    if not adb:
        return {'ok': False, 'error': '未找到 adb（请确认 D:\\scrcpy\\adb.exe）', 'devices': []}
    try:
        devs = list_devices(adb)
    except Exception as e:
        return {'ok': False, 'error': str(e), 'devices': []}
    return {'ok': True, 'devices': devs, 'adb': adb}


@app.post('/api/device/select')
def api_select_device(req: DeviceReq):
    update_state(device=req.serial)
    return {'ok': True, 'device': req.serial}


@app.get('/api/state')
def api_state():
    with _lock:
        return {'ok': True, 'data': dict(_state)}


@app.get('/api/phase')
def api_phase():
    """单次抓帧 + 阶段识别（前端手动刷新用）。"""
    adb = find_adb()
    with _lock:
        serial = _state['device']
    if not adb or not serial:
        raise HTTPException(400, '未选择设备')
    try:
        img = normalize(capture(adb, serial))
        phase, score = detect_phase(img)
        return {'ok': True, 'phase': phase, 'score': round(score, 3)}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post('/api/capture')
def api_capture():
    """抓一帧，返回 base64（前端预览/调试用）。"""
    adb = find_adb()
    with _lock:
        serial = _state['device']
    if not adb or not serial:
        raise HTTPException(400, '未选择设备')
    try:
        img = normalize(capture(adb, serial))
        ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        b64 = base64.b64encode(buf.tobytes()).decode('ascii')
        return {'ok': True, 'image': 'data:image/jpeg;base64,' + b64,
                'width': img.shape[1], 'height': img.shape[0]}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post('/api/recognize/once')
def api_recognize_once():
    """手动识别一次：抓帧 → 阶段 + 阵营 + ban，并推送到前端状态。"""
    adb = find_adb()
    with _lock:
        serial = _state['device']
    if not adb or not serial:
        raise HTTPException(400, '未选择设备')
    try:
        img = normalize(capture(adb, serial))
    except Exception as e:
        raise HTTPException(500, str(e))
    phase, score = detect_phase(img)
    side = detect_user_side(img) if phase in ('ban', 'pick', 'final') else None
    bans = []
    picks = []
    bank = get_bank()
    try:
        if phase == 'ban':
            bans = recognize_bans(img, bank)
        elif phase in ('pick', 'final'):
            picks = recognize_picks(img, bank)
    except Exception:
        pass
    update_state(phase=phase, phase_score=round(score, 2),
                 user_side=side, bans=bans, picks=picks, error=None)
    return {'ok': True, 'phase': phase, 'user_side': side,
            'ban_count': len(bans), 'bans': bans,
            'pick_count': sum(1 for x in picks if x['hero_id']), 'picks': picks}


@app.post('/api/bp/start')
def api_bp_start():
    global _bp_thread
    with _lock:
        if _state['monitoring']:
            return {'ok': True, 'message': '已在监听中'}
        if not _state['device']:
            raise HTTPException(400, '请先选择设备')
        _state['monitoring'] = True
    _bp_stop.clear()
    _bp_thread = threading.Thread(target=_bp_worker, args=(2.0,), daemon=True)
    _bp_thread.start()
    update_state(monitoring=True, error=None)
    return {'ok': True, 'message': 'BP 监听已启动'}


@app.post('/api/bp/stop')
def api_bp_stop():
    global _bp_thread
    _bp_stop.set()
    with _lock:
        _state['monitoring'] = False
    update_state(monitoring=False)
    return {'ok': True, 'message': 'BP 监听已停止'}


@app.post('/api/data/sync')
def api_data_sync():
    """同步英雄数据（调用 sync_heroes.py）。"""
    try:
        r = subprocess.run([sys.executable, 'scripts/sync_heroes.py'],
                           capture_output=True, encoding='utf-8', errors='replace',
                           timeout=180, creationflags=CREATE_NO_WINDOW)
        return {'ok': r.returncode == 0,
                'output': (r.stdout or '')[-2000:],
                'error': (r.stderr or '')[-1000:]}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get('/api/heroes')
def api_heroes():
    """返回英雄列表（前端展示用）。"""
    try:
        path = 'src/data/heroes.json'
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        heroes = data.get('heroes', [])
        return {'ok': True, 'count': len(heroes),
                'heroes': [{'id': h.get('id'), 'name': h.get('name'),
                            'roles': h.get('roles'), 'tier': h.get('tier'),
                            'positionLabel': h.get('positionLabel')}
                           for h in heroes]}
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------
@app.websocket('/ws')
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.add(websocket)
    with _lock:
        snapshot = dict(_state)
    await websocket.send_text(json.dumps({'type': 'state', 'data': snapshot},
                                         ensure_ascii=False))
    try:
        while True:
            # 保持连接（接收 ping）
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(websocket)


@app.on_event('startup')
async def on_startup():
    global _loop
    _loop = asyncio.get_running_loop()
    print('API 服务已启动')


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8900)
    ap.add_argument('--host', default='127.0.0.1')
    args = ap.parse_args()

    import uvicorn
    print('=' * 62)
    print('  王者BP助手 v3.0 · API 服务')
    print('  http://%s:%d' % (args.host, args.port))
    print('  文档: http://%s:%d/docs' % (args.host, args.port))
    print('=' * 62)
    # pythonw 等无控制台环境下 stdout 可能为 None，uvicorn 默认日志会报错；
    # 这里显式把日志配置成「只输出 warning 且写 stderr（可能为 None 时跳过）」。
    uvicorn.run(app, host=args.host, port=args.port,
                log_level='warning', log_config=None, access_log=False)


if __name__ == '__main__':
    main()
