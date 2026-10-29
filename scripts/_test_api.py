# -*- coding: utf-8 -*-
"""测试小鱼 · API 端点验证（http://127.0.0.1:8900）

覆盖范围
--------
1. 基础端点：health / state / devices / heroes / docs / 404
2. 无设备分支：phase、recognize/once、capture、bp/start、bp/stop（有设备时自动跳过，不干扰用户设备）
3. 设备管理：select / connect / disconnect 的参数校验与错误分支
4. 方法校验 / CORS / WebSocket
5. 素材核对新端点（2026-10-29 新增）：
   - GET  /api/review/frames       帧列表（排序/分页/字段）
   - GET  /api/review/crop         裁切 + 识别结果 + lane_icon 字段 + 安全校验
   - GET  /api/review/frame_raw    原图 + 安全校验 + 任意文件读取检查
   - GET  /api/review/marks        标注读取
   - GET  /api/review/summary      核对进度一致性
   - GET  /api/review/export       json/csv 导出（CSV 带 BOM）
   - POST /api/review/mark         标注写入（临时标注，结束后合并还原，绝不丢失用户数据）
6. 边界帧：损坏帧 / 空文件 / 超小图（临时文件，测试后清理）

说明
----
- 不调用 /api/data/sync（会改写 src/data/heroes.json，超出测试边界）。
- 不连接真实设备；不修改服务状态（device 为空时不做 select）。
- POST /api/review/mark 会临时写入 _diag/review.json：
  测试前备份，结束后「只删除本次注入的 key 再写回」，保留用户在测试期间新增的标注。
- API 服务未启动时：打印清晰启动指引并以退出码 2 结束，不抛 traceback。

跑法：python scripts/_test_api.py
输出：_diag/test_api.json
退出码：0 = 无意外失败（已知问题记为 XFAIL）；1 = 有意外失败；2 = API 服务未启动
"""
import base64
import hashlib
import json
import os
import sys
import time
import traceback
import argparse

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIAG_DIR = os.path.join(ROOT, '_diag')
REVIEW_PATH = os.path.join(DIAG_DIR, 'review.json')

# 默认 8900（用户现场）；可用 --base 或环境变量 BP_API_BASE 指向其它端口，
# 例如验收最新代码时另起 8902，避免打断正在运行的服务。
BASE = os.environ.get('BP_API_BASE', 'http://127.0.0.1:8900').rstrip('/')
OUT_JSON = os.path.join(DIAG_DIR, 'test_api.json')

RECORDS = []
T0 = time.time()

# 已知问题（失败不计意外失败，报告里单列）
KNOWN_ISSUES = {
    'KI-1': 'review/crop 的 pick 分支未回传 lane_icon（裁切已判为空位，但 UI 显示"（空）"'
            '而非"分路图标"；recognize_picks 已返回 lane_icon 字段，接线即可）',
    'KI-6': 'frame_raw 未做扩展名白名单，可读取 _diag 下任意文件（仅防路径穿越）',
    'KI-7': '空（0 字节）帧触发未捕获 cv2.error → 500 纯文本，应为 4xx JSON',
}


def rec(case, item, expected, actual, ok, note='', ms=None, ki=None):
    """记录一条用例。

    ok=True  → PASS
    ok=True + ki → XPASS（已知问题已修复）
    ok=False + ki → XFAIL（已知问题，不算回归）
    ok=False → FAIL（意外失败）
    """
    if ok:
        verdict = 'XPASS' if ki else 'PASS'
    else:
        verdict = 'XFAIL' if ki else 'FAIL'
    r = {'case': case, 'item': item, 'expected': expected, 'actual': actual,
         'pass': bool(ok), 'verdict': verdict, 'known_issue': ki,
         'note': note, 'ms': ms}
    RECORDS.append(r)
    print('[%s] %-5s %-46s expect=%-26s actual=%s %s%s%s' % (
        verdict, case, item, expected, actual, note or '',
        (' [%s]' % ki) if ki else '',
        (' %.1fms' % ms) if ms is not None else ''))
    return r


def known(case, item, expected, actual, ok, note, ki, ms=None):
    """已知问题用例：失败时记为 XFAIL。"""
    return rec(case, item, expected, actual, ok, note, ms=ms, ki=ki)


def call(method, path, **kw):
    url = BASE + path
    t0 = time.time()
    try:
        r = requests.request(method, url, timeout=kw.pop('timeout', 20), **kw)
        return r, (time.time() - t0) * 1000, None
    except Exception as e:
        return None, (time.time() - t0) * 1000, str(e)


def jbody(r):
    try:
        return r.json()
    except Exception:
        return None


def review_frames():
    """_diag/live_*.png 按 mtime 倒序（与端点实现一致）。"""
    import glob
    files = glob.glob(os.path.join(DIAG_DIR, 'live_*.png'))
    files.sort(key=os.path.getmtime, reverse=True)
    return files


def load_marks():
    if not os.path.isfile(REVIEW_PATH):
        return {}
    with open(REVIEW_PATH, encoding='utf-8') as f:
        return json.load(f).get('marks') or {}


def state_data():
    r, _, _ = call('GET', '/api/state')
    return (jbody(r) or {}).get('data') or {}


# ---------------------------------------------------------------------------
# 1) 基础端点
# ---------------------------------------------------------------------------
def test_basic():
    print('\n=== 1) 基础端点 ===')
    r, ms, err = call('GET', '/api/health')
    ok = r is not None and r.status_code == 200 and (jbody(r) or {}).get('ok') is True
    body = jbody(r) or {}
    rec('api', 'GET /api/health', '200 {ok:true,version,time}',
        '%s %s' % (r.status_code if r is not None else 'ERR', list(body.keys())),
        ok and {'ok', 'version', 'time'} <= set(body), '%s' % err if err else '', round(ms, 1))

    r, ms, err = call('GET', '/api/state')
    body = jbody(r) or {}
    data = body.get('data') or {}
    need = {'device', 'phase', 'phase_score', 'bans', 'user_side', 'picks', 'game_result',
            'player_floor', 'my_hero_id', 'monitoring', 'last_update', 'error'}
    rec('api', 'GET /api/state', '200 {ok,data{12 字段}}',
        '%s 缺: %s' % (r.status_code if r is not None else 'ERR', sorted(need - set(data))),
        r is not None and r.status_code == 200 and need <= set(data),
        'phase=%s monitoring=%s device=%r' % (data.get('phase'), data.get('monitoring'),
                                             data.get('device')))

    r, ms, err = call('GET', '/api/devices')
    body = jbody(r) or {}
    rec('api', 'GET /api/devices', '200 {ok,devices[],adb}',
        '%s ok=%s devices=%s adb=%s' % (r.status_code if r is not None else 'ERR',
                                        body.get('ok'), len(body.get('devices') or []),
                                        body.get('adb')),
        r is not None and r.status_code == 200 and 'devices' in body,
        'devices 可空（无真机时）', round(ms, 1))

    r, ms, err = call('GET', '/api/heroes')
    body = jbody(r) or {}
    heroes = body.get('heroes') or []
    bad = [h for h in heroes if not h.get('id') or not h.get('name')]
    rec('api', 'GET /api/heroes', '200 {ok,count=133,heroes[]}',
        '%s count=%s' % (r.status_code if r is not None else 'ERR', body.get('count')),
        r is not None and r.status_code == 200 and body.get('count') == 133
        and len(heroes) == 133 and not bad,
        '缺 id/name 的条目=%d' % len(bad))

    r, ms, err = call('GET', '/docs')
    rec('api', 'GET /docs', '200 html', str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code == 200)

    r, ms, err = call('GET', '/api/not-exist')
    rec('api', 'GET /api/not-exist', '404', str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code == 404)


# ---------------------------------------------------------------------------
# 2) 无设备时的错误分支（有设备时跳过，避免干扰用户设备）
# ---------------------------------------------------------------------------
def test_no_device(have_device):
    print('\n=== 2) 无设备分支（400 预期）===')
    if have_device:
        for item in ('GET /api/phase', 'POST /api/recognize/once', 'POST /api/capture',
                     'POST /api/bp/start'):
            rec('api', '%s (无设备分支)' % item, 'SKIP', '当前已连接设备，跳过（不干扰用户）',
                True, '有设备时该分支不可验证')
        r, ms, err = call('POST', '/api/bp/stop')
        body = jbody(r) or {}
        rec('api', 'POST /api/bp/stop', '200 {ok:true}',
            '%s %s' % (r.status_code if r is not None else 'ERR', body.get('message')),
            r is not None and r.status_code == 200 and body.get('ok') is True)
        return

    r, ms, err = call('GET', '/api/phase')
    body = jbody(r) or {}
    rec('api', 'GET /api/phase (无设备)', '400 未选择设备',
        '%s %s' % (r.status_code if r is not None else 'ERR', body.get('detail')),
        r is not None and r.status_code == 400, '', round(ms, 1))

    r, ms, err = call('POST', '/api/recognize/once')
    body = jbody(r) or {}
    rec('api', 'POST /api/recognize/once (无设备)', '400 未选择设备',
        '%s %s' % (r.status_code if r is not None else 'ERR', body.get('detail')),
        r is not None and r.status_code == 400, '', round(ms, 1))

    r, ms, err = call('POST', '/api/capture')
    body = jbody(r) or {}
    rec('api', 'POST /api/capture (无设备)', '400 未选择设备',
        '%s %s' % (r.status_code if r is not None else 'ERR', body.get('detail')),
        r is not None and r.status_code == 400, '第 14 个端点（任务清单外）')

    r, ms, err = call('POST', '/api/bp/start')
    body = jbody(r) or {}
    rec('api', 'POST /api/bp/start (无设备)', '400 请先选择设备',
        '%s %s' % (r.status_code if r is not None else 'ERR', body.get('detail')),
        r is not None and r.status_code == 400, '', round(ms, 1))

    r, ms, err = call('POST', '/api/bp/stop')
    body = jbody(r) or {}
    rec('api', 'POST /api/bp/stop', '200 {ok:true}',
        '%s %s' % (r.status_code if r is not None else 'ERR', body.get('message')),
        r is not None and r.status_code == 200 and body.get('ok') is True)


# ---------------------------------------------------------------------------
# 3) 设备选择 / 连接 / 断开
# ---------------------------------------------------------------------------
def test_device():
    print('\n=== 3) 设备管理 ===')
    before = state_data()
    if before.get('device'):
        print('  [提示] 当前已有设备 %r，跳过设备管理写操作，保持用户现场不变'
              % before.get('device'))
        rec('api', '设备管理写操作', 'SKIP', '已有设备连接，跳过', True,
            '不干扰用户正在使用的设备')
        return

    # 3.1 serial 校验：空 serial 现在已拒绝（2026-10-29 新增校验）
    r, ms, err = call('POST', '/api/device/select', json={'serial': ''})
    body = jbody(r) or {}
    rec('api', 'POST /api/device/select (空 serial)', '400 serial 不能为空',
        '%s %s' % (r.status_code if r is not None else 'ERR', body.get('detail')),
        r is not None and r.status_code == 400)

    # 3.2 无效 serial（不在 adb devices 在线列表）
    bad_serial = 'INVALID-TEST-SERIAL-测试小鱼'
    r, ms, err = call('POST', '/api/device/select', json={'serial': bad_serial})
    body = jbody(r) or {}
    rec('api', 'POST /api/device/select (无效 serial)', '400 不在线设备',
        '%s %s' % (r.status_code if r is not None else 'ERR', body.get('detail')),
        r is not None and r.status_code == 400,
        'serial 必须在 adb devices 在线列表；state.device 应保持 None')
    after = state_data()
    rec('api', '无效 serial 不写入 state.device', 'None',
        repr(after.get('device')), after.get('device') in (None, ''))

    # 3.3 select 缺 body → 422
    r, ms, err = call('POST', '/api/device/select')
    rec('api', 'POST /api/device/select (无 body)', '422',
        str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code == 422)

    # 3.4 connect: IP 格式校验
    cases = [
        ('abc', {'ip': 'abc'}, 400),
        ('空串', {'ip': ''}, 400),
        ('只 3 段', {'ip': '192.168.3'}, 400),
        ('带字母 4 段', {'ip': '192.168.3.6a'}, 400),
    ]
    for tag, payload, expect in cases:
        r, ms, err = call('POST', '/api/device/connect', json=payload, timeout=30)
        body = jbody(r) or {}
        rec('api', 'POST /api/device/connect (%s)' % tag, '%d' % expect,
            '%s %s' % (r.status_code if r is not None else 'ERR',
                       str(body.get('detail'))[:40]),
            r is not None and r.status_code == expect, '', round(ms, 1))

    # 3.5 connect: 合法格式但不可达（不做硬断言，只记录）
    r, ms, err = call('POST', '/api/device/connect',
                      json={'ip': '192.0.2.123', 'port': 5555}, timeout=60)
    body = jbody(r) or {}
    rec('api', 'POST /api/device/connect (不可达 IP)', '200 且 ok=false',
        '%s ok=%s msg=%s' % (r.status_code if r is not None else 'ERR', body.get('ok'),
                             str(body.get('message'))[:50]),
        r is not None and r.status_code == 200 and body.get('ok') is False,
        'TEST-NET 地址，不应真的连上', round(ms, 1))

    # 3.6 数值范围校验（弱校验观察）
    r, ms, err = call('POST', '/api/device/connect',
                      json={'ip': '999.999.999.999'}, timeout=60)
    body = jbody(r) or {}
    rec('api', 'POST /api/device/connect (999.999.999.999)', '400（越界 IP 应拒绝）',
        '%s ok=%s' % (r.status_code if r is not None else 'ERR', body.get('ok')),
        r is not None and r.status_code == 400,
        '正则只校验 1~3 位数字，不校验 0~255 范围', round(ms, 1))

    # 3.7 disconnect：需要 body
    r, ms, err = call('POST', '/api/device/disconnect', json={'ip': '192.0.2.123'}, timeout=30)
    body = jbody(r) or {}
    rec('api', 'POST /api/device/disconnect (带 body)', '200 {ok:true,target,message}',
        '%s ok=%s target=%s' % (r.status_code if r is not None else 'ERR', body.get('ok'),
                                body.get('target')),
        r is not None and r.status_code == 200 and body.get('ok') is True, '', round(ms, 1))

    r, ms, err = call('POST', '/api/device/disconnect')
    rec('api', 'POST /api/device/disconnect (无 body)', '200（若无参）或 422',
        str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code in (200, 422),
        '当前实现强制要求 body{ip}，与"断开当前设备"语义不一致')

    # 3.8 disconnect 后 state.device 是否被清空
    r, ms, err = call('POST', '/api/device/disconnect', json={'ip': '192.0.2.123'})
    r2, _, _ = call('GET', '/api/state')
    dev = (jbody(r2) or {}).get('data', {}).get('device')
    rec('api', 'state.device 断开后是否清空', 'None',
        repr(dev), dev in (None, ''),
        '当前 /api/device/disconnect 不清空 device（前端仍显示已连接）')

    # 3.9 恢复干净状态：本轮所有 select 都被拒绝 → device 应仍为 None
    dev = state_data().get('device')
    rec('api', '恢复干净状态 device 为空', 'None/""',
        repr(dev), dev in (None, ''),
        '无效 serial 均被 400 拒绝，无需写操作恢复')


# ---------------------------------------------------------------------------
# 4) 方法 / CORS / WebSocket
# ---------------------------------------------------------------------------
def test_misc():
    print('\n=== 4) 方法校验 / CORS / WebSocket ===')
    r, ms, err = call('GET', '/api/bp/start')
    rec('api', 'GET /api/bp/start (方法错)', '405',
        str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code == 405)

    r, ms, err = call('GET', '/api/health', headers={'Origin': 'http://localhost:5173'})
    hdr = (r.headers if r is not None else {}) or {}
    rec('api', 'CORS 头 (Origin=5173)', 'access-control-allow-origin',
        hdr.get('access-control-allow-origin'),
        'access-control-allow-origin' in {k.lower() for k in hdr})

    # WebSocket /ws：连上应先收到一条 state 快照
    try:
        import websocket  # websocket-client
        ws_url = BASE.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws'
        ws = websocket.create_connection(ws_url, timeout=8)
        msg = ws.recv()
        ws.close()
        data = json.loads(msg)
        rec('api', 'WS /ws 首帧', '{"type":"state","data":{...}}',
            'type=%s 字段数=%d' % (data.get('type'), len((data.get('data') or {}))),
            data.get('type') == 'state' and 'data' in data)
    except ImportError:
        rec('api', 'WS /ws 首帧', 'type=state', 'SKIP（未安装 websocket-client）', True,
            '跳过，不计入失败')
    except Exception as e:
        rec('api', 'WS /ws 首帧', 'type=state', 'EXC %s' % str(e)[:80], False)


# ---------------------------------------------------------------------------
# 5) 素材核对端点（只读）
# ---------------------------------------------------------------------------
def test_review_frames():
    print('\n=== 5.1) GET /api/review/frames ===')
    files = review_frames()
    r, ms, err = call('GET', '/api/review/frames')
    body = jbody(r) or {}
    frames = body.get('frames') or []
    total = body.get('total')
    rec('review', 'GET /api/review/frames', '200 {frames[],total}',
        '%s total=%s len=%s' % (r.status_code if r is not None else 'ERR', total, len(frames)),
        r is not None and r.status_code == 200 and total == len(files)
        and len(frames) == min(80, len(files)),
        '默认 limit=80；total=全部帧数', round(ms, 1))

    need = {'name', 'kind', 'mtime', 'size'}
    bad = [f for f in frames if not need <= set(f)]
    rec('review', 'frames 字段完整', '每项 {name,kind,mtime,size}',
        '缺字段 %d 项 %s' % (len(bad), [f.get('name') for f in bad[:3]]),
        not bad)

    # 排序：与本地按 mtime 倒序一致
    expected_names = [os.path.basename(p) for p in files[:len(frames)]]
    got_names = [f['name'] for f in frames]
    rec('review', 'frames 按 mtime 倒序', '最新在前',
        '前 3: %s' % got_names[:3], got_names == expected_names,
        '与 _diag 实际 mtime 排序比对')

    bad_kind = [f['name'] for f in frames
                if f['kind'] != (f['name'].split('_')[1] if len(f['name'].split('_')) >= 3 else 'unknown')]
    rec('review', 'frames kind 与文件名一致', 'live_<kind>_<time>.png',
        '不一致 %d 项' % len(bad_kind), not bad_kind)

    r, ms, err = call('GET', '/api/review/frames?limit=5')
    body = jbody(r) or {}
    rec('review', 'frames limit=5', '200 且 5 项',
        '%s len=%s' % (r.status_code if r is not None else 'ERR',
                       len(body.get('frames') or [])),
        r is not None and r.status_code == 200 and len(body.get('frames') or []) == 5,
        'total 仍为全部帧数', round(ms, 1))

    r, ms, err = call('GET', '/api/review/frames?limit=0')
    body = jbody(r) or {}
    rec('review', 'frames limit=0', '200 且 0 项（total 不变）',
        '%s len=%s total=%s' % (r.status_code if r is not None else 'ERR',
                                len(body.get('frames') or []), body.get('total')),
        r is not None and r.status_code == 200
        and len(body.get('frames') or []) == 0 and body.get('total') == len(files))

    r, ms, err = call('GET', '/api/review/frames?limit=-1')
    body = jbody(r) or {}
    rec('review', 'frames limit=-1（未校验负数）', '200 且返回合理（记录实际行为）',
        '%s len=%s total=%s' % (r.status_code if r is not None else 'ERR',
                                len(body.get('frames') or []), body.get('total')),
        r is not None and r.status_code == 200,
        'Python 切片 files[: -1] → 少最后一帧；建议校验 limit>=0（低危）')


def _decode_data_url(img_b64):
    """返回 (PNG 宽, PNG 高, 字节数)；不依赖 cv2。"""
    if not img_b64.startswith('data:image/png;base64,'):
        return None
    raw = base64.b64decode(img_b64.split(',', 1)[1])
    if raw[:8] != b'\x89PNG\r\n\x1a\n' or len(raw) < 24:
        return None
    w = int.from_bytes(raw[16:20], 'big')
    h = int.from_bytes(raw[20:24], 'big')
    return w, h, len(raw)


def test_review_crop():
    print('\n=== 5.2) GET /api/review/crop ===')
    # 用户核对为「正确」的真实 ban 位：庄周
    r, ms, err = call('GET', '/api/review/crop',
                      params={'frame': 'live_ban_235654.png', 'kind': 'ban',
                              'side': 'blue', 'index': 2})
    body = jbody(r) or {}
    dims = _decode_data_url(body.get('image') or '')
    rec('review', 'crop ban B2（庄周，用户核对正确）',
        '200 hero=庄周 confident=bool lane_icon=False',
        '%s hero=%s conf=%s lane=%s img=%s' % (
            r.status_code if r is not None else 'ERR', body.get('hero'),
            body.get('confident'), body.get('lane_icon'), dims),
        r is not None and r.status_code == 200 and body.get('hero') == '庄周'
        and isinstance(body.get('confident'), bool)
        and body.get('lane_icon') is False
        and dims is not None and dims[0] == 384 and dims[1] == 384,
        '裁切图放大 4 倍：96*4=384；lane_icon 必须是 bool', round(ms, 1))

    rec('review', 'crop 返回字段完整',
        '{ok,image,frame,kind,side,index,hero,confident,gap,lane_icon,crop}',
        sorted(body.keys()),
        {'image', 'frame', 'kind', 'side', 'index', 'hero', 'confident',
         'gap', 'lane_icon', 'crop'} <= set(body))
    crop = body.get('crop') or {}
    rec('review', 'crop.crop 几何字段', '{cx,cy,r} 数值',
        crop, all(isinstance(crop.get(k), (int, float)) for k in ('cx', 'cy', 'r'))
        and crop.get('r', 0) > 0)

    # final 帧 pick 位（用户核对正确：宫本武藏）
    r, ms, err = call('GET', '/api/review/crop',
                      params={'frame': 'live_pick_235855.png', 'kind': 'pick',
                              'side': 'blue', 'index': 4})
    body = jbody(r) or {}
    rec('review', 'crop pick B4（宫本武藏，用户核对正确）',
        '200 hero=宫本武藏',
        '%s hero=%s conf=%s' % (r.status_code if r is not None else 'ERR',
                                body.get('hero'), body.get('confident')),
        r is not None and r.status_code == 200 and body.get('hero') == '宫本武藏',
        '', round(ms, 1))

    # 选人帧 pick 位（用户核对正确：钟馗）
    r, ms, err = call('GET', '/api/review/crop',
                      params={'frame': 'live_selecting_234229.png', 'kind': 'pick',
                              'side': 'blue', 'index': 2})
    body = jbody(r) or {}
    rec('review', 'crop selecting B2（钟馗，用户核对正确）',
        '200 hero=钟馗',
        '%s hero=%s conf=%s' % (r.status_code if r is not None else 'ERR',
                                body.get('hero'), body.get('confident')),
        r is not None and r.status_code == 200 and body.get('hero') == '钟馗',
        '', round(ms, 1))

    # 用户备注「未选择，实则是对抗路标志」→ 核心金标准：不能返回英雄
    r, ms, err = call('GET', '/api/review/crop',
                      params={'frame': 'live_selecting_234229.png', 'kind': 'pick',
                              'side': 'blue', 'index': 3})
    body = jbody(r) or {}
    rec('review', 'crop selecting B3（对抗路标志，不返回英雄）',
        '200 hero=None（未选择位）',
        '%s hero=%s lane=%s' % (r.status_code if r is not None else 'ERR',
                                body.get('hero'), body.get('lane_icon')),
        r is not None and r.status_code == 200 and body.get('hero') is None,
        '用户标注✗：该位是分路图标，不是英雄', round(ms, 1))
    # 同一位置的 UI 标记（lane_icon）：recognize_picks 已返回，但 crop 端点未接线
    known('review', 'crop selecting B3（lane_icon 接线，UI 显示分路图标）',
          '200 lane_icon=True',
          '%s lane=%s' % (r.status_code if r is not None else 'ERR',
                          body.get('lane_icon')),
          r is not None and r.status_code == 200 and body.get('lane_icon') is True,
          'recognize_picks 已返回 lane_icon 字段；api_server pick 分支未透传', 'KI-1')

    # 用户核对正确的真实 ban 盾山：不应被 lane_icon 误标（2026-10-29 修复后回归守卫）
    r, ms, err = call('GET', '/api/review/crop',
                      params={'frame': 'live_ban_234154.png', 'kind': 'ban',
                              'side': 'blue', 'index': 3})
    body = jbody(r) or {}
    rec('review', 'crop ban B3（盾山，真实 ban 不误标）',
        '200 hero=盾山 lane_icon=False',
        '%s hero=%s lane=%s' % (r.status_code if r is not None else 'ERR',
                                body.get('hero'), body.get('lane_icon')),
        r is not None and r.status_code == 200 and body.get('hero') == '盾山'
        and body.get('lane_icon') is False,
        '旧模板曾把真实 ban 判成 lane_icon 并清空 hero（已修复）', round(ms, 1))

    # 安全校验：非法 frame 名必须 400（不允许路径穿越）
    print('  -- 安全校验：非法 frame 名应 400 --')
    illegal = ['../review.json', 'a/b.png', '..\\x.png', '', 'live/../live_ban_234142.png',
               '/etc/passwd', 'review.json/..', 'a\\..\\b.png']
    for bad in illegal:
        r, ms, err = call('GET', '/api/review/crop',
                          params={'frame': bad, 'kind': 'ban', 'side': 'blue', 'index': 2})
        body = jbody(r) or {}
        rec('review', 'crop 非法 frame=%r' % bad, '400 非法文件名',
            '%s %s' % (r.status_code if r is not None else 'ERR', body.get('detail')),
            r is not None and r.status_code == 400, '', round(ms, 1))

    # URL 编码的穿越也必须被拦（直接拼 query string）
    for raw in ('%2e%2e%2freview.json', '..%5creview.json', '%2fetc%2fpasswd'):
        url = '/api/review/crop?frame=%s&kind=ban&side=blue&index=2' % raw
        r, ms, err = call('GET', url)
        rec('review', 'crop URL 编码穿越 %r' % raw, '400',
            str(r.status_code if r is not None else 'ERR'),
            r is not None and r.status_code == 400)

    # 合法但不存在 → 404
    r, ms, err = call('GET', '/api/review/crop',
                      params={'frame': 'live_nonexistent_999999.png', 'kind': 'ban',
                              'side': 'blue', 'index': 2})
    body = jbody(r) or {}
    rec('review', 'crop 不存在的帧', '404 帧不存在',
        '%s %s' % (r.status_code if r is not None else 'ERR', body.get('detail')),
        r is not None and r.status_code == 404)

    # 缺 frame 参数 → 422
    r, ms, err = call('GET', '/api/review/crop', params={'kind': 'ban'})
    rec('review', 'crop 缺 frame 参数', '422',
        str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code == 422)

    # 非法 side / index → 404（位置不存在）
    for tag, params, expect in [
        ('side=xxx', {'frame': 'live_ban_234142.png', 'kind': 'ban', 'side': 'xxx', 'index': 1}, 404),
        ('index=0', {'frame': 'live_ban_234142.png', 'kind': 'ban', 'side': 'blue', 'index': 0}, 404),
        ('index=6', {'frame': 'live_ban_234142.png', 'kind': 'ban', 'side': 'blue', 'index': 6}, 404),
        ('index=-1', {'frame': 'live_ban_234142.png', 'kind': 'ban', 'side': 'blue', 'index': -1}, 404),
        ('index=999', {'frame': 'live_ban_234142.png', 'kind': 'ban', 'side': 'blue', 'index': 999}, 404),
        ('side=BLUE 大写', {'frame': 'live_ban_234142.png', 'kind': 'ban', 'side': 'BLUE', 'index': 2}, 404),
    ]:
        r, ms, err = call('GET', '/api/review/crop', params=params)
        body = jbody(r) or {}
        rec('review', 'crop 非法参数 %s' % tag, '%d 位置不存在' % expect,
            '%s %s' % (r.status_code if r is not None else 'ERR', body.get('detail')),
            r is not None and r.status_code == expect, '', round(ms, 1))

    # kind 未校验（非 ban 一律按 pick 处理，观察项）
    r, ms, err = call('GET', '/api/review/crop',
                      params={'frame': 'live_ban_234142.png', 'kind': 'xxx',
                              'side': 'blue', 'index': 2})
    rec('review', 'crop kind=xxx（未校验，观察项）', '记录实际行为',
        '%s hero=%s' % (r.status_code if r is not None else 'ERR',
                        (jbody(r) or {}).get('hero')),
        r is not None and r.status_code == 200,
        'kind 只分 ban/其他，未知值走 pick 布局 → 建议校验 kind∈{ban,pick}', round(ms, 1))


def test_review_frame_raw():
    print('\n=== 5.3) GET /api/review/frame_raw ===')
    frame = 'live_ban_234142.png'
    path = os.path.join(DIAG_DIR, frame)
    r, ms, err = call('GET', '/api/review/frame_raw', params={'frame': frame})
    content = r.content if r is not None else b''
    rec('review', 'frame_raw 原图', '200 image/png + PNG 魔数 + 字节数一致',
        '%s ct=%s len=%d magic=%r' % (
            r.status_code if r is not None else 'ERR',
            r.headers.get('content-type') if r is not None else None,
            len(content), content[:8]),
        r is not None and r.status_code == 200
        and content[:8] == b'\x89PNG\r\n\x1a\n'
        and len(content) == os.path.getsize(path),
        '', round(ms, 1))

    for bad in ('../review.json', 'a/b.png', '..\\x.png'):
        r, ms, err = call('GET', '/api/review/frame_raw', params={'frame': bad})
        rec('review', 'frame_raw 非法 frame=%r' % bad, '400',
            str(r.status_code if r is not None else 'ERR'),
            r is not None and r.status_code == 400)

    r, ms, err = call('GET', '/api/review/frame_raw',
                      params={'frame': 'live_nonexistent_999999.png'})
    rec('review', 'frame_raw 不存在的帧', '404',
        str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code == 404)

    r, ms, err = call('GET', '/api/review/frame_raw')
    rec('review', 'frame_raw 缺 frame 参数', '422',
        str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code == 422)

    # 扩展名白名单检查（观察项）：review.json 不是图片，但能被 frame_raw 读取
    r, ms, err = call('GET', '/api/review/frame_raw', params={'frame': 'review.json'})
    known('review', 'frame_raw 读取非图片文件', '400/404（应限制 live_*.png 白名单）',
          '%s ct=%s len=%s' % (r.status_code if r is not None else 'ERR',
                               r.headers.get('content-type') if r is not None else None,
                               len(r.content) if r is not None else 0),
          r is not None and r.status_code in (400, 404),
          '安全兜底只有路径穿越检查，_diag 下任意文件都能被当 png 下载', 'KI-6')


def test_review_marks_export_summary():
    print('\n=== 5.4) GET /api/review/marks · export · summary ===')
    marks_file = load_marks()
    r, ms, err = call('GET', '/api/review/marks')
    body = jbody(r) or {}
    marks = body.get('marks') or {}
    rec('review', 'GET /api/review/marks', '200 {marks:{42 条}}',
        '%s marks=%d' % (r.status_code if r is not None else 'ERR', len(marks)),
        r is not None and r.status_code == 200 and marks == marks_file,
        '与 _diag/review.json 内容一致', round(ms, 1))

    # --- export json ---
    r, ms, err = call('GET', '/api/review/export?format=json')
    body = jbody(r) or {}
    rec('review', 'export json', '200 application/json 且与 marks 一致',
        '%s ct=%s marks=%d' % (r.status_code if r is not None else 'ERR',
                               (r.headers.get('content-type') if r is not None else None),
                               len(body.get('marks') or {})),
        r is not None and r.status_code == 200
        and (body.get('marks') or {}) == marks_file,
        '', round(ms, 1))

    # --- export csv ---
    r, ms, err = call('GET', '/api/review/export?format=csv')
    content = (r.content if r is not None else b'')
    text = ''
    try:
        text = content.decode('utf-8')
    except Exception:
        pass
    lines = [ln for ln in text.splitlines() if ln.strip()]
    hdr = lines[0].lstrip('\ufeff') if lines else ''
    import csv as _csv
    rows = list(_csv.reader(lines[1:])) if len(lines) > 1 else []
    rec('review', 'export csv', '200 text/csv + BOM + 表头 + %d 数据行' % len(marks_file),
        '%s ct=%s BOM=%s hdr=%r rows=%d' % (
            r.status_code if r is not None else 'ERR',
            r.headers.get('content-type') if r is not None else None,
            text.startswith('\ufeff'), hdr, len(rows)),
        r is not None and r.status_code == 200
        and 'text/csv' in (r.headers.get('content-type') or '')
        and text.startswith('\ufeff')
        and hdr == 'frame,kind,side,index,correct,note,at'
        and len(rows) == len(marks_file),
        'BOM 让 Excel 正确识别中文；Content-Disposition=%r'
        % (r.headers.get('content-disposition') if r is not None else None), round(ms, 1))

    # CSV 行内容抽查：第一行应与某个标注对应，correct 只能是 0/1
    ok_rows = all(len(row) == 7 and row[4] in ('0', '1') and row[0].startswith('live_')
                  for row in rows)
    rec('review', 'export csv 行结构', '7 列 + correct∈{0,1} + frame=live_*',
        '不合法行 %d' % sum(1 for row in rows
                            if len(row) != 7 or row[4] not in ('0', '1')
                            or not row[0].startswith('live_')),
        ok_rows)

    r, ms, err = call('GET', '/api/review/export?format=xml')
    body = jbody(r) or {}
    rec('review', 'export 未知 format（观察项）', '记录实际行为',
        '%s ct=%s 有 marks=%s' % (
            r.status_code if r is not None else 'ERR',
            r.headers.get('content-type') if r is not None else None,
            'marks' in body),
        r is not None and r.status_code == 200,
        '未知 format 回落为 JSON；建议 400 或忽略参数', round(ms, 1))

    # --- summary ---
    files = review_frames()
    r, ms, err = call('GET', '/api/review/summary')
    body = jbody(r) or {}
    frames = body.get('frames') or []
    total_marks = sum(f.get('marks', 0) for f in frames)
    marked = sum(1 for f in frames if f.get('marks', 0) > 0)
    done = sum(1 for f in frames if f.get('marks', 0) >= 10)
    rec('review', 'GET /api/review/summary 汇总字段', 'total_frames/marked/done/total_marks 一致',
        '%s total=%s marked=%s/%s done=%s/%s marks=%s/%s' % (
            r.status_code if r is not None else 'ERR', body.get('total_frames'),
            body.get('marked_frames'), marked, body.get('done_frames'), done,
            body.get('total_marks'), total_marks),
        r is not None and r.status_code == 200
        and body.get('total_frames') == len(files)
        and len(frames) == len(files)
        and body.get('marked_frames') == marked
        and body.get('done_frames') == done
        and body.get('total_marks') == len(marks_file)
        and total_marks == len(marks_file),
        'done 定义：单帧标注数 >= 10', round(ms, 1))

    bad = [f for f in frames if not {'name', 'kind', 'mtime', 'marks', 'correct', 'done'} <= set(f)]
    rec('review', 'summary 每帧字段完整', '{name,kind,mtime,marks,correct,done}',
        '缺字段 %d 项' % len(bad), not bad)

    done_bad = [f['name'] for f in frames if bool(f.get('done')) != (f.get('marks', 0) >= 10)]
    rec('review', 'summary done 与标注数一致', 'done == (marks>=10)',
        '不一致 %d 项 %s' % (len(done_bad), done_bad[:3]), not done_bad)


# ---------------------------------------------------------------------------
# 5.5) POST /api/review/mark（临时写入 + 合并还原）
# ---------------------------------------------------------------------------
def test_review_mark():
    print('\n=== 5.5) POST /api/review/mark（临时标注，结束后还原）===')
    if not os.path.isfile(REVIEW_PATH):
        rec('review', 'POST /api/review/mark', 'review.json 存在',
            '不存在，跳过（避免创建用户数据文件）', True, 'SKIP')
        return
    with open(REVIEW_PATH, 'rb') as f:
        backup_bytes = f.read()
    backup_sha = hashlib.sha256(backup_bytes).hexdigest()
    backup_marks = json.loads(backup_bytes.decode('utf-8')).get('marks') or {}
    injected_key = 'live_ban_234142.png|ban|blue|1'   # 用户未标注的位置
    frame, kind, side, index = injected_key.split('|')

    def key_count():
        r, _, _ = call('GET', '/api/review/marks')
        return len((jbody(r) or {}).get('marks') or {})

    # 若该 key 已存在（用户新增标注），换一个不冲突位置：blue1..5
    if injected_key in backup_marks:
        for cand in ('live_ban_234142.png|ban|blue|2',
                     'live_ban_234142.png|ban|red|1'):
            if cand not in backup_marks:
                injected_key = cand
                frame, kind, side, index = cand.split('|')
                break

    try:
        r, ms, err = call('POST', '/api/review/mark',
                          json={'frame': frame, 'kind': kind, 'side': side,
                                'index': int(index), 'correct': False,
                                'note': '  _test_api_临时标注  '})
        body = jbody(r) or {}
        rec('review', 'POST /api/review/mark 新增', '200 {ok:true,marks=+1}',
            '%s ok=%s marks=%s' % (r.status_code if r is not None else 'ERR',
                                   body.get('ok'), body.get('marks')),
            r is not None and r.status_code == 200 and body.get('ok') is True
            and body.get('marks') == len(backup_marks) + 1, '', round(ms, 1))

        r, _, _ = call('GET', '/api/review/marks')
        marks = (jbody(r) or {}).get('marks') or {}
        saved = marks.get(injected_key) or {}
        rec('review', 'mark 写入后可读回', 'correct=False note=已 strip',
            'correct=%s note=%r' % (saved.get('correct'), saved.get('note')),
            saved.get('correct') is False and saved.get('note') == '_test_api_临时标注',
            'note 前后空格应被 strip')

        # 同一 key 覆盖：correct 改 True，note 清空
        r, ms, err = call('POST', '/api/review/mark',
                          json={'frame': frame, 'kind': kind, 'side': side,
                                'index': int(index), 'correct': True, 'note': ''})
        body = jbody(r) or {}
        r2, _, _ = call('GET', '/api/review/marks')
        marks2 = (jbody(r2) or {}).get('marks') or {}
        saved2 = marks2.get(injected_key) or {}
        rec('review', 'mark 同 key 覆盖（不重复计数）',
            '200 且计数不变，correct=True',
            'marks=%s correct=%s' % (body.get('marks'), saved2.get('correct')),
            r is not None and r.status_code == 200
            and body.get('marks') == len(backup_marks) + 1
            and saved2.get('correct') is True)

        # 非法 frame 名 → 400 且不写入
        before_cnt = len(marks2)
        r, ms, err = call('POST', '/api/review/mark',
                          json={'frame': '../review.json', 'kind': 'ban',
                                'side': 'blue', 'index': 1, 'correct': True})
        after_cnt = key_count()
        rec('review', 'mark 非法 frame（../）', '400 且不写入',
            '%s detail=%s marks %d->%d' % (
                r.status_code if r is not None else 'ERR',
                (jbody(r) or {}).get('detail'), before_cnt, after_cnt),
            r is not None and r.status_code == 400 and after_cnt == before_cnt)

        r, ms, err = call('POST', '/api/review/mark',
                          json={'frame': '', 'kind': 'ban', 'side': 'blue',
                                'index': 1, 'correct': True})
        rec('review', 'mark 空 frame', '400 且不写入',
            '%s %s' % (r.status_code if r is not None else 'ERR',
                       (jbody(r) or {}).get('detail')),
            r is not None and r.status_code == 400 and key_count() == before_cnt)

        r, ms, err = call('POST', '/api/review/mark')
        rec('review', 'mark 缺 body', '422',
            str(r.status_code if r is not None else 'ERR'),
            r is not None and r.status_code == 422)

        r, ms, err = call('GET', '/api/review/export?format=json')
        body = jbody(r) or {}
        rec('review', 'mark 即时反映到 export', 'marks=+1',
            'marks=%s' % len(body.get('marks') or {}),
            r is not None and r.status_code == 200
            and len(body.get('marks') or {}) == len(backup_marks) + 1)

        # 观察项：不存在的帧也能写入（无文件校验）
        ghost = 'live_nonexistent_999999.png|pick|red|1'
        r, _, _ = call('POST', '/api/review/mark',
                       json={'frame': 'live_nonexistent_999999.png', 'kind': 'pick',
                             'side': 'red', 'index': 1, 'correct': True})
        r2, _, _ = call('GET', '/api/review/marks')
        has_ghost = ghost in ((jbody(r2) or {}).get('marks') or {})
        rec('review', 'mark 不存在的帧（观察项）', '记录实际行为',
            '%s 已写入=%s' % (r.status_code if r is not None else 'ERR', has_ghost),
            r is not None and r.status_code == 200,
            '端点不校验帧存在；幽灵标注会进入统计（建议 404）')
    finally:
        # 合并还原：只删除本次注入的 2 个 key，保留用户在测试期间新增的标注
        try:
            current = json.loads(open(REVIEW_PATH, encoding='utf-8').read()) \
                if os.path.isfile(REVIEW_PATH) else {'marks': {}}
            cur_marks = current.get('marks') or {}
            removed = []
            for jk in (injected_key, 'live_nonexistent_999999.png|pick|red|1'):
                if jk in cur_marks:
                    del cur_marks[jk]
                    removed.append(jk)
            current['marks'] = cur_marks
            with open(REVIEW_PATH, 'w', encoding='utf-8') as f:
                json.dump(current, f, ensure_ascii=False, indent=2)
            restored_marks = current['marks']
            missing = sorted(k for k in backup_marks if k not in restored_marks)
            changed = sorted(k for k in backup_marks
                             if k in restored_marks and restored_marks[k] != backup_marks[k])
            clean = not missing and not changed
            rec('review', '标注数据还原（不丢用户数据）',
                '原有 %d 条标注全部保留' % len(backup_marks),
                'removed=%d missing=%d changed=%d' % (len(removed), len(missing), len(changed)),
                clean, '合并还原：只删测试注入 key')
            with open(REVIEW_PATH, 'rb') as f:
                now_sha = hashlib.sha256(f.read()).hexdigest()
            rec('review', '标注文件 SHA-256 还原', backup_sha[:16],
                now_sha[:16], now_sha == backup_sha,
                '若用户测试期间新增标注，SHA 变化属预期；以「原有标注完整」为准')
        except Exception as e:
            rec('review', '标注数据还原', '成功', 'EXC %s' % e, False,
                '还原失败！请检查 %s' % REVIEW_PATH)


# ---------------------------------------------------------------------------
# 6) 边界帧：损坏帧 / 空文件 / 超小图（临时文件，测试后清理）
# ---------------------------------------------------------------------------
TMP_FRAMES = []


def _write_tmp(name, data):
    path = os.path.join(DIAG_DIR, name)
    with open(path, 'wb') as f:
        f.write(data)
    TMP_FRAMES.append(path)
    return path


def test_review_boundary_frames():
    print('\n=== 6) 边界帧：损坏帧 / 空文件 / 超小图 ===')
    # 8x8 绿色小图 PNG（93 字节，cv2 生成的合法文件）
    png_tiny = base64.b64decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAJElEQVQIHW3BAQEAAACCIP1/'
        'rFkdEGQkGUlGkpFkJBlJRpKRDrcKBklwZoIHAAAAAElFTkSuQmCC')
    corrupt = _write_tmp('_boundary_tmp_corrupt.png', b'this is not a png')
    empty = _write_tmp('_boundary_tmp_empty.png', b'')
    tiny = _write_tmp('_boundary_tmp_tiny.png', png_tiny)
    try:
        total_before = len(review_frames())
        r, ms, err = call('GET', '/api/review/crop',
                          params={'frame': os.path.basename(corrupt), 'kind': 'ban',
                                  'side': 'blue', 'index': 1})
        body = jbody(r) or {}
        rec('review', 'crop 损坏帧（非 PNG 内容）',
            '500 + JSON detail（异常路径明确，服务不崩溃）',
            '%s detail=%s' % (r.status_code if r is not None else 'ERR',
                              body.get('detail')),
            r is not None and r.status_code == 500
            and isinstance(body.get('detail'), str), '', round(ms, 1))

        r, ms, err = call('GET', '/api/review/crop',
                          params={'frame': os.path.basename(empty), 'kind': 'ban',
                                  'side': 'blue', 'index': 1})
        body = jbody(r) or {}
        ctype = (r.headers.get('content-type') if r is not None else '') or ''
        r2, _, _ = call('GET', '/api/health')
        alive = r2 is not None and r2.status_code == 200
        known('review', 'crop 空文件（0 字节）',
              '4xx + JSON（服务保持存活）',
              '%s ct=%s body=%r health=%s' % (
                  r.status_code if r is not None else 'ERR', ctype,
                  (r.text if r is not None else '')[:40], alive),
              r is not None and 400 <= r.status_code < 500 and 'json' in ctype and alive,
              '空文件触发未捕获 cv2.error → 500 纯文本；服务未崩溃但建议 4xx JSON',
              'KI-7', round(ms, 1))

        r, ms, err = call('GET', '/api/review/crop',
                          params={'frame': os.path.basename(tiny), 'kind': 'ban',
                                  'side': 'blue', 'index': 1})
        body = jbody(r) or {}
        dims = _decode_data_url(body.get('image') or '')
        rec('review', 'crop 超小图（8x8）', '200 且不崩溃（归一化后裁切）',
            '%s hero=%s img=%s' % (r.status_code if r is not None else 'ERR',
                                   body.get('hero'), dims),
            r is not None and r.status_code == 200 and dims is not None,
            'normalize 放大到 1920 宽后再裁切；应返回图片而非异常', round(ms, 1))

        r, ms, err = call('GET', '/api/review/frame_raw',
                          params={'frame': os.path.basename(tiny)})
        rec('review', 'frame_raw 超小图', '200 image/png',
            '%s len=%s' % (r.status_code if r is not None else 'ERR',
                           len(r.content) if r is not None else 0),
            r is not None and r.status_code == 200 and r.content[:8] == b'\x89PNG\r\n\x1a\n')

        # 临时文件不应出现在 frames 列表（命名不是 live_*）
        total_after = len(review_frames())
        rec('review', '临时测试帧不污染帧列表', '帧数不变',
            '%d -> %d' % (total_before, total_after), total_after == total_before)
    finally:
        for path in TMP_FRAMES:
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except Exception:
                pass
        TMP_FRAMES.clear()


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def check_server():
    r, ms, err = call('GET', '/api/health', timeout=3)
    if r is None:
        print('=' * 78)
        print('  [未启动] 无法连接 API 服务：%s' % BASE)
        print('  %s' % (err or ''))
        print('')
        print('  请先启动服务，再运行本测试：')
        print('    python scripts/api_server.py        # 前台运行')
        print('    或双击 启动v3.0.bat / 启动投屏.bat')
        print('')
        print('  本次未执行任何用例（不是测试失败）。')
        print('=' * 78)
        return False
    return True


def main():
    global BASE
    ap = argparse.ArgumentParser(description='API 端点验证')
    ap.add_argument('--base', default=BASE,
                    help='API 地址（默认 8900；也可用环境变量 BP_API_BASE）')
    args = ap.parse_args()
    BASE = args.base.rstrip('/')

    print('=' * 78)
    print('  测试小鱼 · API 验证  %s   %s' % (BASE, time.strftime('%Y-%m-%d %H:%M:%S')))
    print('=' * 78)
    if not check_server():
        return 2
    try:
        test_basic()
        have_device = bool(state_data().get('device'))
        test_no_device(have_device)
        test_device()
        test_misc()
        test_review_frames()
        test_review_crop()
        test_review_frame_raw()
        test_review_marks_export_summary()
        test_review_mark()
        test_review_boundary_frames()
    except Exception:
        traceback.print_exc()
        rec('api', '未捕获异常', '无异常', '见 traceback', False)

    total = len(RECORDS)
    passed = sum(1 for r in RECORDS if r['verdict'] in ('PASS', 'XPASS'))
    fails = [r for r in RECORDS if r['verdict'] == 'FAIL']
    xfails = [r for r in RECORDS if r['verdict'] == 'XFAIL']
    xpasses = [r for r in RECORDS if r['verdict'] == 'XPASS']
    print('\n' + '=' * 78)
    print('  小计: %d 项 / PASS %d / FAIL %d / XFAIL(已知问题) %d / XPASS %d   （总耗时 %.1fs）' % (
        total, passed, len(fails), len(xfails), len(xpasses), time.time() - T0))
    if xfails:
        by_ki = {}
        for r in xfails:
            by_ki.setdefault(r['known_issue'], []).append(r['item'])
        for ki in sorted(by_ki):
            print('    [XFAIL %s] %d 项：%s' % (ki, len(by_ki[ki]), KNOWN_ISSUES.get(ki, '')))
            for item in by_ki[ki]:
                print('        - %s' % item)
    for r in xpasses:
        print('    [XPASS] %s：已知问题已修复，请更新 KNOWN_ISSUES' % r['item'])
    for r in fails:
        print('    [FAIL] %s %s: expect=%s actual=%s' % (
            r['case'], r['item'], r['expected'], r['actual']))
    print('=' * 78)

    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump({'generated': time.strftime('%Y-%m-%d %H:%M:%S'),
                   'base': BASE, 'total': total, 'passed': passed,
                   'failed': len(fails), 'xfail': len(xfails), 'xpass': len(xpasses),
                   'known_issues': KNOWN_ISSUES,
                   'exit_code': 1 if fails else 0,
                   'records': RECORDS}, f, ensure_ascii=False, indent=1)
    print('明细已写入 %s' % OUT_JSON)
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
