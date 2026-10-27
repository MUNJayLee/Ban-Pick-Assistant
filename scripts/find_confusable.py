# -*- coding: utf-8 -*-
"""找出 ORB 特征最易混淆的英雄对（用于定向判别器的英雄清单）。"""
import sys
import os
import json
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recognize_screenshot as R


def main():
    manifest = json.load(open('avatars/manifest.json', encoding='utf-8'))
    ids = [m['id'] for m in manifest]
    name_by_id = {m['id']: m['name'] for m in manifest}

    orb = cv2.ORB_create(nfeatures=1000)
    des = {}
    for hid in ids:
        av = R.circular(R.imread_unicode('avatars/%s.jpg' % hid), 48)
        kp, d = orb.detectAndCompute(av, None)
        if d is not None:
            des[hid] = d

    bf = cv2.BFMatcher(cv2.NORM_HAMMING)

    def match(a, b):
        ms = bf.knnMatch(des[a], des[b], k=2)
        return len([m for m, n in ms if m.distance < 0.75 * n.distance])

    # 对每个英雄，找出除自己外 ORB 匹配分最高的（top 混淆对象）
    confusions = []
    for a in ids:
        scores = [(b, match(a, b)) for b in ids if b != a]
        scores.sort(key=lambda kv: -kv[1])
        top = scores[0]
        confusions.append((a, top[0], top[1]))

    # 互相混淆对：A 的 top 混淆是 B，且 B 的 top 混淆是 A（或互在 top3）
    top_map = {a: b for a, b, s in confusions}
    print('=== 每个英雄的 ORB top1 混淆对象（除自己外）===')
    # 找出「互相」混淆的对
    mutual = set()
    for a, b, s in confusions:
        if s == 0:
            continue
        if top_map.get(b) == a:
            pair = tuple(sorted([a, b]))
            mutual.add(pair)
    print('\n互相混淆对（A 的 top1 是 B，B 的 top1 是 A）:')
    for a, b in sorted(mutual):
        print('  %s <-> %s' % (name_by_id[a], name_by_id[b]))

    # 按混淆分排序，列出 top30 高混淆对（包括非互相的）
    print('\nORB 混淆分数最高的 30 个英雄（分数=与 top 混淆对象的匹配数）:')
    confusions.sort(key=lambda kv: -kv[2])
    for a, b, s in confusions[:30]:
        print('  %-14s -> %-14s (%d)' % (name_by_id[a], name_by_id[b], s))

    # 已知问题英雄的混淆情况
    print('\n已知问题英雄的 top5 混淆:')
    for hid in ['kai', 'guanyu', 'cang', 'simayi', 'houyi', 'diaochan']:
        scores = [(b, match(hid, b)) for b in ids if b != hid]
        scores.sort(key=lambda kv: -kv[1])
        print('  %s: %s' % (name_by_id[hid], [(name_by_id[b], s) for b, s in scores[:5]]))


if __name__ == '__main__':
    main()
