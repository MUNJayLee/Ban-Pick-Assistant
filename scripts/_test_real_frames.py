# -*- coding: utf-8 -*-
"""真机帧回归测试：遍历 _diag 里的真机截图，跑识别并输出结构化结果。

用途：
  1. 明晚用户核对时的清单（每帧识别出了什么）
  2. 回归测试（改动后重跑，看结果是否变化）
  3. 建金标准的基础（用户核对后标注 expected）

用法：
  python scripts/_test_real_frames.py            # 全部帧
  python scripts/_test_real_frames.py --limit 20 # 只看最近 20 帧
  python scripts/_test_real_frames.py --final    # 只看 final 帧（抓帧命名 live_pick_*）
  python scripts/_test_real_frames.py --ban      # 只看 ban 帧

输出：
  控制台摘要 + _diag/test_real_frames.json（完整结果）
"""
import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import recognize_screenshot as R
import live_recognize as L

DIAG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_diag')


def frame_kind(name):
    """从文件名判断类型：live_<kind>_<HHMMSS>.png"""
    parts = os.path.basename(name).split('_')
    return parts[1] if len(parts) >= 3 else 'unknown'


def process_frame(path, bank):
    img = R.imread_unicode(path)
    if img is None:
        return None
    n = L.normalize(img)
    kind = frame_kind(path)
    out = {
        'frame': os.path.basename(path),
        'kind': kind,
        'size': '%dx%d' % (n.shape[1], n.shape[0]),
    }
    try:
        bans = L.recognize_bans(n, bank)
        out['bans'] = [
            {'side': b['side'], 'index': b['index'], 'hero_id': b['hero_id'],
             'name': b['name'], 'confident': b['confident'], 'gap': b['gap']}
            for b in bans
        ]
        out['ban_count'] = len(bans)
        out['ban_blue'] = sum(1 for b in bans if b['side'] == 'blue')
        out['ban_red'] = sum(1 for b in bans if b['side'] == 'red')
    except Exception as e:
        out['bans'] = []
        out['ban_error'] = str(e)

    # 只有 final（最后调整）和 pick 帧才识别 picks
    if kind in ('pick', 'selecting'):
        try:
            out['is_selecting'] = L.is_selecting_screen(n)
        except Exception:
            out['is_selecting'] = None
        if not out.get('is_selecting'):
            try:
                picks = L.recognize_picks(n, bank)
                out['picks'] = [
                    {'side': p['side'], 'index': p['index'], 'hero_id': p['hero_id'],
                     'name': p['name'], 'confident': p['confident'], 'empty': p['empty']}
                    for p in picks
                ]
                out['pick_count'] = sum(1 for p in picks if not p['empty'])
            except Exception as e:
                out['picks'] = []
                out['pick_error'] = str(e)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='只看最近 N 帧')
    ap.add_argument('--ban', action='store_true', help='只看 ban 帧')
    ap.add_argument('--final', action='store_true', help='只看 pick/final 帧')
    args = ap.parse_args()

    frames = sorted(glob.glob(os.path.join(DIAG_DIR, 'live_*.png')),
                    key=lambda p: os.path.getmtime(p))
    if args.ban:
        frames = [f for f in frames if frame_kind(f) == 'ban']
    elif args.final:
        frames = [f for f in frames if frame_kind(f) in ('pick', 'selecting')]
    if args.limit > 0:
        frames = frames[-args.limit:]

    if not frames:
        print('没有匹配的帧')
        return

    bank = L.FeatureBank()
    results = []
    print('处理 %d 帧...' % len(frames))
    print()
    for i, f in enumerate(frames, 1):
        r = process_frame(f, bank)
        if r is None:
            continue
        results.append(r)
        # 摘要
        line = '[%s] %s' % (r['kind'], r['frame'])
        if 'ban_count' in r:
            line += ' ban=%d(B%d/R%d)' % (r['ban_count'], r['ban_blue'], r['ban_red'])
            if r['bans']:
                line += ' ' + ' '.join('%s%d' % ('B' if b['side'] == 'blue' else 'R', b['index'])
                                       for b in r['bans'])
        if 'pick_count' in r:
            line += ' pick=%d' % r['pick_count']
        if r.get('is_selecting'):
            line += ' [选人界面]'
        print(line)

    print()
    print('=' * 70)
    total_bans = sum(r.get('ban_count', 0) for r in results)
    print('共 %d 帧，ban 识别合计 %d 个' % (len(results), total_bans))

    out_path = os.path.join(DIAG_DIR, 'test_real_frames.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({
            'generated': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
            'frame_count': len(results),
            'results': results,
        }, f, ensure_ascii=False, indent=2)
    print('明细: %s' % out_path)


if __name__ == '__main__':
    main()
