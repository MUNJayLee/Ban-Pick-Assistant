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
import re
import subprocess
import sys
import threading
import time
from datetime import datetime
from typing import Optional

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Response
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import glob as _glob_mod
import live_recognize as L
import recognize_screenshot as R
from live_recognize import (
    is_selecting_screen,
    FeatureBank, detect_phase, recognize_bans, recognize_picks, format_bans, normalize,
    recognize_picks_cached,
    detect_user_side, detect_game_result, detect_result_hero, detect_player_floor,
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
    'game_result': None,     # {is_result,result,is_mvp,delta} 对局结算
    'player_floor': None,    # 玩家楼层（1~5，我方）
    'my_hero_id': None,      # 自动识别的「我的英雄」
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
_DIAG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_diag')
_DIAG_LOG = os.path.join(_DIAG_DIR, 'recog.log')


def _diag_log(msg):
    """写诊断日志（_diag/recog.log）。"""
    try:
        if not os.path.isdir(_DIAG_DIR):
            os.makedirs(_DIAG_DIR, exist_ok=True)
        with open(_DIAG_LOG, 'a', encoding='utf-8') as f:
            f.write('%s %s\n' % (datetime.now().strftime('%H:%M:%S'), msg))
    except Exception:
        pass


def _vote_bans(votes, bans_now, min_votes=2):
    """多帧投票：累计每帧 ban 识别结果，返回票数达标的稳定结果。

    解决单帧不稳定问题（同一位置不同帧识别出不同英雄，如「后羿 vs 孙膑」）。
    票数 >= min_votes 的位置才输出，取票数最高的英雄。

    votes: {(side, index): {hero_id: [count, last_dict]}}
    """
    for b in bans_now:
        key = (b['side'], b['index'])
        d = votes.setdefault(key, {})
        if b['hero_id'] in d:
            d[b['hero_id']][0] += 1
            d[b['hero_id']][1] = b
        else:
            d[b['hero_id']] = [1, b]
    out = []
    for key, d in votes.items():
        best = max(d.values(), key=lambda x: x[0])
        if best[0] >= min_votes:
            out.append(best[1])
    return out


def _diag_frame(img, tag):
    """保存诊断帧（_diag/live_<tag>_<HHMMSS>.png），保留最近 40 张。"""
    try:
        if not os.path.isdir(_DIAG_DIR):
            os.makedirs(_DIAG_DIR, exist_ok=True)
        path = os.path.join(_DIAG_DIR, 'live_%s_%s.png' % (
            tag, datetime.now().strftime('%H%M%S')))
        cv2.imwrite(path, img)
        # 清理旧的（按修改时间，不能按文件名——live_ban_* 按字母序最前会被优先删掉）
        import glob
        files = glob.glob(os.path.join(_DIAG_DIR, 'live_*.png'))
        files.sort(key=lambda x: os.path.getmtime(x))
        for old in files[:-150]:
            try:
                os.remove(old)
            except Exception:
                pass
    except Exception as e:
        try:
            with open(_DIAG_LOG, 'a', encoding='utf-8') as f:
                f.write('%s _diag_frame(%s) 失败: %s\n' % (
                    datetime.now().strftime('%H:%M:%S'), tag, e))
        except Exception:
            pass


def _bp_worker(interval=2.0):
    adb = find_adb()
    if not adb:
        update_state(error='未找到 adb', monitoring=False)
        return
    bank = get_bank()
    prev_phase = None
    prev_bans_key = None
    prev_picks_key = None
    last_result_check = 0.0
    last_floor_check = 0.0
    last_diag_frame = 0.0
    ban_votes = {}   # 多帧投票：{(side, index): {hero_id: [count, last_dict]}}
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
                _diag_log('phase -> %s (score=%.2f)' % (phase, pscore))
                updates = {'phase': phase, 'phase_score': round(pscore, 2), 'error': None}
                if phase == 'ban':
                    updates['game_result'] = None
                    updates['player_floor'] = None
                    updates['my_hero_id'] = None
                if phase == 'final':
                    # final（最后调整）的 ban 位是最终版；
                    # pick 阶段（选人界面）显示的是临时值 → 重新投票
                    ban_votes.clear()
                    _diag_log('final 阶段：重新投票 ban（丢弃 pick 阶段的临时值）')
                update_state(**updates)

            # 阵营识别（左侧框颜色）——只在 BP 界面才判断，避免其他游戏误判
            side = detect_user_side(img) if phase in ('ban', 'pick', 'final') else None
            with _lock:
                prev_side = _state['user_side']
            if side and side != prev_side:
                update_state(user_side=side)

            if phase == 'ban':
                bans = recognize_bans(img, bank)
                _diag_log('ban 识别: %d 个 | %s' % (
                    len(bans), format_bans(bans) if bans else '(空)'))
                if time.time() - last_diag_frame > 2:
                    last_diag_frame = time.time()
                    _diag_frame(img, 'ban')
                key = tuple((b['side'], b['hero_id']) for b in bans)
                if key != prev_bans_key:
                    prev_bans_key = key
                    ban_votes.clear()   # 新一局 / ban 结果变化 → 重新投票
                    update_state(bans=bans)
                    # 每次 ban 结果变化都存帧（红方 ban 可能只持续几秒，靠定时间隔会漏）
                    _diag_frame(img, 'ban')
                    print('[%s] %s' % (datetime.now().strftime('%H:%M:%S'),
                                       format_bans(bans)))
                prev_picks_key = None
            elif phase in ('pick', 'final'):
                # pick 阶段（选人界面）不识别 pick：队伍头像是玩家预选，不是最终阵容
                # 只有 final（最后调整，阵容已锁定）才识别
                if phase == 'pick':
                    if prev_picks_key != '__pick_skip__':
                        prev_picks_key = '__pick_skip__'
                        _diag_log('pick 阶段（选人界面），跳过 pick 识别，等最后调整')
                        # 清空上一局残留的 picks（否则前端显示旧阵容）
                        update_state(picks=[])
                    if time.time() - last_diag_frame > 2:
                        last_diag_frame = time.time()
                        _diag_frame(img, 'selecting')
                    # 选人界面顶部 ban 位已完整 → 多帧投票补 ban（比等 final 更早）
                    try:
                        bans_now = recognize_bans(img, bank, skip_lane_icons=True)
                        voted = _vote_bans(ban_votes, bans_now)
                        # 投票够 10 个用投票结果；不够（帧太少）用单帧兜底
                        if len(voted) >= 10:
                            with _lock:
                                cur_bans = list(_state['bans'])
                            update_state(bans=voted)
                            _diag_log('pick 阶段投票补 ban: %d -> 10 个' % len(cur_bans))
                        elif len(bans_now) >= 10:
                            update_state(bans=bans_now)
                            _diag_log('pick 阶段单帧补 ban: -> 10 个')
                    except Exception:
                        pass
                    continue
                if time.time() - last_diag_frame > 2:
                    last_diag_frame = time.time()
                    _diag_frame(img, 'pick')
                # 补识别 ban：ban 阶段红方 ban 位可能延迟显示/不显示，
                # 到 pick/final 阶段顶部 ban 位一定齐全，补上缺失的
                try:
                    # final 阶段是真实 ban（阵容已锁定），不过滤分路图标
                    # （分路图标与盾山等蓝色机械英雄视觉相似，过滤会误伤）
                    bans_now = recognize_bans(img, bank, skip_lane_icons=False)
                    # final（最后调整）顶部 10 个 ban 一定齐全且是最终版本
                    # → 多帧投票（解决单帧不稳定，如 R1 后羿/孙膑 来回变）
                    voted = _vote_bans(ban_votes, bans_now)
                    # 投票够 10 个用投票（稳定）；不够（final 帧太少）用单帧兜底（完整）
                    if len(voted) >= 10:
                        with _lock:
                            cur_bans = list(_state['bans'])
                        update_state(bans=voted)
                        _diag_log('final 投票补 ban: %d -> 10 个（%s）' % (
                            len(cur_bans),
                            ' '.join('%s%d=%s' % ('B' if b['side'] == 'blue' else 'R',
                                                  b['index'], b['name']) for b in voted)))
                    elif len(bans_now) >= 10:
                        with _lock:
                            cur_bans = list(_state['bans'])
                        update_state(bans=bans_now)
                        _diag_log('final 单帧补 ban: %d -> 10 个（帧太少，用最后一帧）' % len(cur_bans))
                except Exception:
                    pass
                picks = recognize_picks_cached(img, bank)
                pkey = tuple((x['side'], x['index'], x['hero_id']) for x in picks)
                if pkey != prev_picks_key:
                    prev_picks_key = pkey
                    update_state(picks=picks)
                # 玩家楼层识别（OCR 较慢，15 秒一次）→ 该楼位的英雄即「我的英雄」
                if time.time() - last_floor_check > 15:
                    last_floor_check = time.time()
                    floor, _names = detect_player_floor(img)
                    if floor:
                        target = next((x for x in picks
                                       if x['side'] == 'blue' and x['index'] == floor
                                       and x.get('hero_id')), None)
                        if target:
                            update_state(player_floor=floor,
                                         my_hero_id=target['hero_id'])
                            print('[%s] 玩家 %d 楼 -> 我的英雄: %s' % (
                                datetime.now().strftime('%H:%M:%S'),
                                floor, target['name']))
                    n_blue = sum(1 for x in picks if x['side'] == 'blue' and x['hero_id'])
                    n_red = sum(1 for x in picks if x['side'] == 'red' and x['hero_id'])
                    print('[%s] picks: 我方 %d / 敌方 %d' % (
                        datetime.now().strftime('%H:%M:%S'), n_blue, n_red))
                prev_bans_key = None
            else:
                prev_bans_key = None
                prev_picks_key = None
                # 非 BP 阶段也存帧（诊断用），但降频到 20 秒，
                # 避免大量 other 帧把 ban/pick 关键帧挤出保留窗口
                if time.time() - last_diag_frame > 20:
                    last_diag_frame = time.time()
                    _diag_frame(img, 'other')
                # 非 BP 阶段：定期检测对局结算界面（OCR 较慢，6 秒一次）
                if time.time() - last_result_check > 6:
                    last_result_check = time.time()
                    gr = detect_game_result(img)
                    if gr['is_result']:
                        # MVP 画面尝试识别玩家自己的英雄（圆形头像）
                        my_hero = None
                        if gr['is_mvp']:
                            h = detect_result_hero(img, bank)
                            if h and h['confident']:
                                my_hero = h
                        gr['my_hero_id'] = my_hero['hero_id'] if my_hero else None
                        gr['my_hero_name'] = my_hero['name'] if my_hero else None
                        update_state(game_result=gr)
                        print('[%s] 结算: %s mvp=%s delta=%s 我的英雄=%s' % (
                            datetime.now().strftime('%H:%M:%S'),
                            gr['result'], gr['is_mvp'], gr['delta'],
                            gr.get('my_hero_name') or '-'))
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
    serial = (req.serial or '').strip()
    if not serial:
        raise HTTPException(status_code=400, detail='serial 不能为空')
    # 校验 serial 是否在 adb devices 在线列表（避免写入不存在的设备）
    try:
        adb = find_adb() or DEFAULT_ADB
        r = _run([adb, 'devices'], capture_output=True, timeout=10)
        lines = (r.stdout or b'').decode('utf-8', 'ignore').splitlines()
        online = []
        for line in lines[1:]:
            parts = line.strip().split()
            if len(parts) >= 2 and parts[1] == 'device':
                online.append(parts[0])
        if serial not in online:
            raise HTTPException(
                status_code=400,
                detail='设备未连接或不在线: %s（当前在线: %s）'
                        % (serial, ', '.join(online) if online else '无'),
            )
    except HTTPException:
        raise
    except Exception:
        pass  # adb 不可用时放行（允许离线场景）
    update_state(device=serial)
    return {'ok': True, 'device': serial}


def _valid_ip(ip: str) -> bool:
    """校验 IPv4 格式且每段 0~255。"""
    parts = ip.split('.')
    if len(parts) != 4:
        return False
    for part in parts:
        if not part.isdigit():
            return False
        n = int(part)
        if n < 0 or n > 255:
            return False
    return True


class DeviceConnectPayload(BaseModel):
    ip: str
    port: int = 5555


@app.post('/api/device/connect')
def api_device_connect(payload: DeviceConnectPayload):
    """通过 WiFi 连接设备（adb connect <ip>:<port>）。"""
    ip = (payload.ip or '').strip()
    if not _valid_ip(ip):
        raise HTTPException(status_code=400, detail='IP 格式不正确（示例 192.168.3.62）')
    port = int(payload.port or 5555)
    target = '%s:%d' % (ip, port)
    adb = find_adb() or DEFAULT_ADB
    try:
        r = _run([adb, 'connect', target], capture_output=True, timeout=10)
        out = (r.stdout or b'').decode('utf-8', 'ignore').strip()
        err = (r.stderr or b'').decode('utf-8', 'ignore').strip()
    except Exception as e:
        # 连接失败（超时/不可达）不应 500，返回 200 + ok=false
        return {'ok': False, 'target': target,
                'message': '连接失败: %s' % e}
    low = (out + ' ' + err).lower()
    ok = ('connected' in low and 'cannot' not in low and 'failed' not in low) \
        or 'already connected' in low
    if ok:
        update_state(device=target, error=None)
        print('[%s] WiFi 已连接: %s' % (datetime.now().strftime('%H:%M:%S'), target))
    return {'ok': ok, 'target': target, 'message': out or err or '无输出'}


@app.post('/api/device/disconnect')
def api_device_disconnect(payload: DeviceConnectPayload):
    """断开 WiFi 设备（adb disconnect <ip>:<port>）。"""
    ip = (payload.ip or '').strip()
    if not _valid_ip(ip):
        raise HTTPException(status_code=400, detail='IP 格式不正确')
    target = '%s:%d' % (ip, int(payload.port or 5555))
    adb = find_adb() or DEFAULT_ADB
    try:
        r = _run([adb, 'disconnect', target], capture_output=True, timeout=15)
        out = (r.stdout or b'').decode('utf-8', 'ignore').strip()
    except Exception as e:
        return {'ok': False, 'target': target,
                'message': '断开失败: %s' % e}
    # 断开成功 → 清空当前选中设备（避免前端仍显示已连接）
    with _lock:
        _state['device'] = None
    return {'ok': True, 'target': target, 'message': out or '已断开'}


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
            picks = recognize_picks_cached(img, bank)
    except Exception:
        pass
    # 非 BP 界面时，手动识别也尝试检测结算
    game_result = None
    if phase == 'other':
        gr = detect_game_result(img)
        if gr['is_result']:
            my_hero = None
            if gr['is_mvp']:
                h = detect_result_hero(img, bank)
                if h and h['confident']:
                    my_hero = h
            gr['my_hero_id'] = my_hero['hero_id'] if my_hero else None
            gr['my_hero_name'] = my_hero['name'] if my_hero else None
            game_result = gr
    # 手动识别时也尝试识别玩家楼层（pick/final 阶段）
    player_floor = None
    my_hero_id = None
    if phase in ('pick', 'final') and picks:
        floor, _names = detect_player_floor(img)
        if floor:
            target = next((x for x in picks
                           if x['side'] == 'blue' and x['index'] == floor
                           and x.get('hero_id')), None)
            if target:
                player_floor = floor
                my_hero_id = target['hero_id']
    update_state(phase=phase, phase_score=round(score, 2),
                 user_side=side, bans=bans, picks=picks,
                 game_result=game_result, player_floor=player_floor,
                 my_hero_id=my_hero_id, error=None)
    return {'ok': True, 'phase': phase, 'user_side': side,
            'ban_count': len(bans), 'bans': bans,
            'pick_count': sum(1 for x in picks if x['hero_id']), 'picks': picks,
            'game_result': game_result,
            'player_floor': player_floor, 'my_hero_id': my_hero_id}


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
    # 预热：启动时加载特征库（含 warm_up 预热识别管线），OCR 冷加载放后台线程，
    # 避免首个 ban 帧识别时才付冷启动开销（实测首次 ~1.4s → 稳态 ~0.3s）
    try:
        get_bank()
        threading.Thread(target=L._get_ocr, daemon=True).start()
    except Exception:
        pass
    print('API 服务已启动')


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
# ===========================================================================
# 素材核对（人工标注）：显示裁切头像 + 识别结果，人工判断对错 + 备注
# ===========================================================================

_REVIEW_PATH = os.path.join(_DIAG_DIR, 'review.json')


def _load_reviews():
    try:
        if os.path.isfile(_REVIEW_PATH):
            with open(_REVIEW_PATH, encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return {'marks': {}}


def _save_reviews(data):
    try:
        os.makedirs(_DIAG_DIR, exist_ok=True)
        with open(_REVIEW_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def _slot_positions(img, kind):
    """返回 [(side, index, cx, cy, r)]，用于裁切。"""
    H, W = img.shape[:2]
    out = []
    if kind == 'ban':
        # 优先 Hough（自适应）—— 坐标和半径必须与 recognize_bans 完全一致：
        #   1) 半径用 5+5 个圆的中位数（B5 的 Hough 半径常偏小）
        #   2) 圆心向屏幕中心微调 2px（蓝方 -2、红方 +2，修「裁切框偏右」）
        try:
            left, right = R.detect_circles(img)
            l2 = R.validate_row(left) if left else []
            r2 = R.validate_row(right) if right else []
            if len(l2) == 5 and len(r2) == 5:
                rs = sorted([c[2] for c in l2] + [c[2] for c in r2])
                r_med = rs[len(rs) // 2]
                for i, (cx, cy, _r) in enumerate(l2, 1):
                    out.append(('blue', i, cx - 2, cy, r_med))
                for i, (cx, cy, _r) in enumerate(r2, 1):
                    out.append(('red', i, cx + 2, cy, r_med))
                return out
        except Exception:
            pass
        # fallback 固定比例
        r = max(8, int(round(W * L.BAN_R_RATIO)))
        cy = int(round(H * L.BAN_Y_RATIO))
        for i, xr in enumerate(L.BAN_X_RATIOS, 1):
            out.append(('blue', i, W * xr, cy, r))
            out.append(('red', i, W * (1.0 - xr), cy, r))
    else:  # pick
        r = max(8, int(round(W * 0.0234)))
        for i in range(5):
            cy = int(round(H * (0.1713 + 0.1620 * i)))
            out.append(('blue', i + 1, W * 0.0859, cy, r))
            out.append(('red', i + 1, W * (1.0 - 0.0859), cy, r))
    return out


@app.get('/api/review/frames')
def api_review_frames(limit: int = 80):
    """最近 N 帧（最新在前）。"""
    files = _glob_mod.glob(os.path.join(_DIAG_DIR, 'live_*.png'))
    files.sort(key=os.path.getmtime, reverse=True)
    out = []
    for f in files[:limit]:
        base = os.path.basename(f)
        parts = base.split('_')
        out.append({
            'name': base,
            'kind': parts[1] if len(parts) >= 3 else 'unknown',
            'mtime': datetime.fromtimestamp(os.path.getmtime(f)).strftime('%H:%M:%S'),
            'size': os.path.getsize(f),
        })
    return {'frames': out, 'total': len(files)}


@app.get('/api/review/crop')
def api_review_crop(frame: str, kind: str = 'ban', side: str = 'blue', index: int = 1):
    """裁切一个位置（放大 4 倍），返回 base64 + 识别结果。"""
    if not frame or '/' in frame or '\\' in frame or '..' in frame:
        raise HTTPException(status_code=400, detail='非法文件名')
    path = os.path.join(_DIAG_DIR, frame)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail='帧不存在')
    img = R.imread_unicode(path)
    if img is None:
        raise HTTPException(status_code=500, detail='读取失败')
    n = L.normalize(img)
    pos = _slot_positions(n, kind)
    target = next((x for x in pos if x[0] == side and x[1] == index), None)
    if not target:
        raise HTTPException(status_code=404, detail='位置不存在: %s %d' % (side, index))
    _, _, cx, cy, r = target
    crop = L.crop_avatar(n, int(round(cx)), int(round(cy)), int(round(r)))
    if crop is None or crop.size == 0:
        raise HTTPException(status_code=500, detail='裁切失败')
    big = cv2.resize(crop, (crop.shape[1] * 4, crop.shape[0] * 4), interpolation=cv2.INTER_NEAREST)
    ok, buf = cv2.imencode('.png', big)
    if not ok:
        raise HTTPException(status_code=500, detail='编码失败')
    b64 = base64.b64encode(buf.tobytes()).decode('ascii')
    # 识别结果
    hero = None
    confident = None
    gap = None
    bank = get_bank()
    lane_icon = False
    if kind == 'ban':
        # 分路图标检测只在「选人/BP pick 阶段」做：
        #   ban 阶段（live_ban_*）显示的是真实被 ban 英雄（含盾山等蓝色机械，
        #   与对抗路图标视觉相似），不能按分路图标过滤，否则误删真实 ban。
        _is_lane_phase = ('selecting' in frame) or ('pick' in frame)
        if _is_lane_phase:
            try:
                crop_tmp = L.crop_avatar(n, int(round(cx)), int(round(cy)), int(round(r)))
                lane_icon = bool(L.is_lane_icon(crop_tmp)) if crop_tmp is not None else False
            except Exception:
                lane_icon = False
        bans = L.recognize_bans(n, bank)
        b = next((x for x in bans if x['side'] == side and x['index'] == index), None)
        if b:
            hero = b['name']
            confident = b['confident']
            gap = b['gap']
        if lane_icon:
            hero = None
            confident = False
    else:
        picks = L.recognize_picks(n, bank)
        pp = next((x for x in picks if x['side'] == side and x['index'] == index), None)
        if pp:
            # pick 阶段的分路图标（玩家未选英雄）→ 标记 lane_icon，hero 置空
            lane_icon = bool(pp.get('lane_icon'))
            hero = None if pp['empty'] else pp['name']
            confident = pp['confident']
            gap = pp.get('gap')
    return {
        'ok': True,
        'image': 'data:image/png;base64,' + b64,
        'frame': frame, 'kind': kind, 'side': side, 'index': index,
        'hero': hero, 'confident': confident, 'gap': gap,
        'lane_icon': lane_icon,
        'crop': {'cx': round(cx, 1), 'cy': round(cy, 1), 'r': round(r, 1)},
    }


@app.get('/api/review/frame_raw')
def api_review_frame_raw(frame: str):
    """返回原始帧图片（大图预览用）。"""
    if not frame or '/' in frame or '\\' in frame or '..' in frame:
        raise HTTPException(status_code=400, detail='非法文件名')
    path = os.path.join(_DIAG_DIR, frame)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail='帧不存在')
    return FileResponse(path, media_type='image/png')


@app.get('/api/review/marks')
def api_review_marks():
    return _load_reviews()


@app.get('/api/review/summary')
def api_review_summary():
    """核对进度摘要：总帧数 / 已标注帧数 / 每帧标注数。"""
    files = _glob_mod.glob(os.path.join(_DIAG_DIR, 'live_*.png'))
    files.sort(key=os.path.getmtime, reverse=True)
    marks = _load_reviews().get('marks', {})
    frame_marks = {}
    frame_correct = {}
    for k, v in marks.items():
        f = k.split('|')[0]
        frame_marks[f] = frame_marks.get(f, 0) + 1
        if v.get('correct'):
            frame_correct[f] = frame_correct.get(f, 0) + 1
    frames = []
    for f in files:
        base = os.path.basename(f)
        parts = base.split('_')
        n = frame_marks.get(base, 0)
        frames.append({
            'name': base,
            'kind': parts[1] if len(parts) >= 3 else 'unknown',
            'mtime': datetime.fromtimestamp(os.path.getmtime(f)).strftime('%H:%M:%S'),
            'marks': n,
            'correct': frame_correct.get(base, 0),
            'done': n >= 10,
        })
    marked_frames = sum(1 for fr in frames if fr['marks'] > 0)
    done_frames = sum(1 for fr in frames if fr['done'])
    return {
        'total_frames': len(files),
        'marked_frames': marked_frames,
        'done_frames': done_frames,
        'total_marks': len(marks),
        'frames': frames,
    }


@app.get('/api/review/export')
def api_review_export(format: str = 'json'):
    """导出标注：json / csv。"""
    data = _load_reviews()
    marks = data.get('marks', {})
    if format == 'csv':
        import csv as _csv
        import io as _io
        buf = _io.StringIO()
        w = _csv.writer(buf)
        w.writerow(['frame', 'kind', 'side', 'index', 'correct', 'note', 'at'])
        for v in marks.values():
            w.writerow([v.get('frame'), v.get('kind'), v.get('side'), v.get('index'),
                        '1' if v.get('correct') else '0', v.get('note') or '', v.get('at')])
        return Response(
            content='\ufeff' + buf.getvalue(),   # BOM 让 Excel 正确识别中文
            media_type='text/csv; charset=utf-8',
            headers={'Content-Disposition': 'attachment; filename=review_marks.csv'},
        )
    return data


@app.post('/api/review/mark')
def api_review_mark(req: dict):
    """保存标注：{frame, kind, side, index, correct(bool), note(str)}"""
    frame = req.get('frame') or ''
    if not frame or '/' in frame or '\\' in frame or '..' in frame:
        raise HTTPException(status_code=400, detail='非法文件名')
    data = _load_reviews()
    key = '%s|%s|%s|%s' % (frame, req.get('kind', 'ban'), req.get('side', 'blue'), req.get('index', 1))
    data.setdefault('marks', {})[key] = {
        'frame': frame,
        'kind': req.get('kind', 'ban'),
        'side': req.get('side', 'blue'),
        'index': req.get('index', 1),
        'correct': bool(req.get('correct')),
        'note': (req.get('note') or '').strip(),
        'at': datetime.now().isoformat(timespec='seconds'),
    }
    ok = _save_reviews(data)
    return {'ok': ok, 'marks': len(data.get('marks', {}))}


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
