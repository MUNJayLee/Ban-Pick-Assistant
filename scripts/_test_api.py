# -*- coding: utf-8 -*-
"""测试小鱼 · API 端点验证（http://127.0.0.1:8900）

覆盖 13 个端点 + WebSocket + CORS + 错误处理。
注意：不调用 /api/data/sync（会改写 src/data/heroes.json，超出测试边界）。
真机未连接：所有「需要设备」的正常分支无法验证，只验证无设备分支。

跑法：python scripts/_test_api.py
输出：_diag/test_api.json
"""
import json
import os
import sys
import time
import traceback

import requests

BASE = 'http://127.0.0.1:8900'
OUT_JSON = '_diag/test_api.json'
RECORDS = []
T0 = time.time()


def rec(case, item, expected, actual, ok, note='', ms=None):
    r = {'case': case, 'item': item, 'expected': expected, 'actual': actual,
         'pass': bool(ok), 'note': note, 'ms': ms}
    RECORDS.append(r)
    print('[%s] %-4s %-38s expect=%-24s actual=%s %s' % (
        'PASS' if ok else 'FAIL', case, item, expected, actual, note or ''))
    return r


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
        '未连真机→devices 空列表属预期', round(ms, 1))

    r, ms, err = call('GET', '/api/heroes')
    body = jbody(r) or {}
    heroes = body.get('heroes') or []
    bad = [h for h in heroes if not h.get('id') or not h.get('name')]
    rec('api', 'GET /api/heroes', '200 {ok,count=133,heroes[]}',
        '%s count=%s' % (r.status_code if r is not None else 'ERR', body.get('count')),
        r is not None and r.status_code == 200 and body.get('count') == 133
        and len(heroes) == 133 and not bad,
        '缺 id/name 的条目=%d' % len(bad))

    # 文档页
    r, ms, err = call('GET', '/docs')
    rec('api', 'GET /docs', '200 html', str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code == 200)

    # 404 处理
    r, ms, err = call('GET', '/api/not-exist')
    rec('api', 'GET /api/not-exist', '404', str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code == 404)


# ---------------------------------------------------------------------------
# 2) 无设备时的错误分支（必须在 select 之前跑）
# ---------------------------------------------------------------------------
def test_no_device():
    print('\n=== 2) 无设备分支（400 预期）===')
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
    # 3.1 无效 serial（端点无校验，记录真实行为）
    bad_serial = 'INVALID-TEST-SERIAL-测试小鱼'
    r, ms, err = call('POST', '/api/device/select', json={'serial': bad_serial})
    body = jbody(r) or {}
    rec('api', 'POST /api/device/select (无效 serial)', '200 或 400（无校验则 200）',
        '%s device=%r' % (r.status_code if r is not None else 'ERR', body.get('device')),
        r is not None and r.status_code in (200, 400),
        '端点不校验 serial 合法性；选中后 /api/phase 会因抓帧失败返回 500')

    # 选中无效 serial 后 /api/phase 应报错（非 200）
    r, ms, err = call('GET', '/api/phase', timeout=45)
    body = jbody(r) or {}
    rec('api', 'GET /api/phase (无效设备已选中)', '非 200（抓帧失败）',
        '%s %s' % (r.status_code if r is not None else 'ERR',
                   str(body.get('detail'))[:60]),
        r is not None and r.status_code != 200, '', round(ms, 1))

    # 3.2 select 缺 body → 422
    r, ms, err = call('POST', '/api/device/select')
    rec('api', 'POST /api/device/select (无 body)', '422',
        str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code == 422)

    # 3.3 connect: IP 格式校验
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

    # 3.4 connect: 合法格式但不可达（不做硬断言，只记录）
    r, ms, err = call('POST', '/api/device/connect',
                      json={'ip': '192.0.2.123', 'port': 5555}, timeout=60)
    body = jbody(r) or {}
    rec('api', 'POST /api/device/connect (不可达 IP)', '200 且 ok=false',
        '%s ok=%s msg=%s' % (r.status_code if r is not None else 'ERR', body.get('ok'),
                             str(body.get('message'))[:50]),
        r is not None and r.status_code == 200 and body.get('ok') is False,
        'TEST-NET 地址，不应真的连上', round(ms, 1))

    # 3.5 数值范围校验（弱校验观察）
    r, ms, err = call('POST', '/api/device/connect',
                      json={'ip': '999.999.999.999'}, timeout=60)
    body = jbody(r) or {}
    rec('api', 'POST /api/device/connect (999.999.999.999)', '400（越界 IP 应拒绝）',
        '%s ok=%s' % (r.status_code if r is not None else 'ERR', body.get('ok')),
        r is not None and r.status_code == 400,
        '正则只校验 1~3 位数字，不校验 0~255 范围', round(ms, 1))

    # 3.6 disconnect：需要 body
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

    # 3.7 disconnect 后 state.device 是否被清空
    r, ms, err = call('POST', '/api/device/disconnect', json={'ip': '192.0.2.123'})
    r2, _, _ = call('GET', '/api/state')
    dev = (jbody(r2) or {}).get('data', {}).get('device')
    rec('api', 'state.device 断开后是否清空', 'None',
        repr(dev), dev in (None, ''),
        '当前 /api/device/disconnect 不清空 device（前端仍显示已连接）')

    # 3.8 恢复干净状态：把 device 置空串（服务无"清除设备"接口）
    r, ms, err = call('POST', '/api/device/select', json={'serial': ''})
    rec('api', '恢复状态 device=""', '200', str(r.status_code if r is not None else 'ERR'),
        r is not None and r.status_code == 200, '服务端无清空接口，用空串代替 null')


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
        ws = websocket.create_connection('ws://127.0.0.1:8900/ws', timeout=8)
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


def main():
    print('=' * 78)
    print('  测试小鱼 · API 验证  %s   %s' % (BASE, time.strftime('%Y-%m-%d %H:%M:%S')))
    print('=' * 78)
    try:
        test_basic()
        test_no_device()
        test_device()
        test_misc()
    except Exception:
        traceback.print_exc()

    total = len(RECORDS)
    passed = sum(1 for r in RECORDS if r['pass'])
    print('\n' + '=' * 78)
    print('  小计: %d 项 / 通过 %d / 失败 %d   （总耗时 %.1fs）' % (
        total, passed, total - passed, time.time() - T0))
    for r in RECORDS:
        if not r['pass']:
            print('    [FAIL] %s %s: expect=%s actual=%s' % (
                r['case'], r['item'], r['expected'], r['actual']))
    print('=' * 78)
    json.dump({'generated': time.strftime('%Y-%m-%d %H:%M:%S'),
               'base': BASE, 'total': total, 'passed': passed,
               'failed': total - passed, 'records': RECORDS},
              open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('明细已写入 %s' % OUT_JSON)
    return 0


if __name__ == '__main__':
    sys.exit(main())
