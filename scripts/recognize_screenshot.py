# -*- coding: utf-8 -*-
# 截图识别（改进版）：HoughCircles 自动定位 ban 圆头像 + ORB 特征匹配
# 可选：调用硅基流动的多模态大模型（Qwen-VL）识别英雄名，更鲁棒。
# 用法: python scripts/recognize_screenshot.py <截图路径>
# 环境变量 SILICONFLOW_API_KEY 配置后自动启用多模态识别。
import sys
import os
import json
import base64
import urllib.request
import cv2
import numpy as np

SUPABASE_URL = 'https://nvgvaphzhqgsbxqrfoyb.supabase.co'
PUBLISHABLE_KEY = 'sb_publishable_DJHwKetxg1LHNFdwlhF6jA_eQ88lwaZ'


def fetch_training_samples():
    """从 Supabase 拉取修正标注样本（hero_id + image_b64），失败时返回空列表。"""
    url = SUPABASE_URL + '/rest/v1/training_samples?select=hero_id,image_b64&limit=2000'
    req = urllib.request.Request(url, headers={'apikey': PUBLISHABLE_KEY})
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        sys.stderr.write('[samples] 拉取训练样本失败：%s\n' % e)
        return []

def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

def circular(img, size):
    img = cv2.resize(img, (size, size))
    m = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(m, (size//2, size//2), size//2, 255, -1)
    img = img.copy(); img[m == 0] = 0
    return cv2.resize(img, (256, 256))


def _color_hist(img):
    """HSV 颜色直方图（H×S 二维，圆形掩码只取头像内容），返回归一化向量。"""
    img = cv2.resize(img, (64, 64))
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    m = np.zeros((64, 64), dtype=np.uint8)
    cv2.circle(m, (32, 32), 32, 255, -1)
    h = cv2.calcHist([hsv], [0, 1], m, [18, 12], [0, 180, 0, 256])
    cv2.normalize(h, h)
    return h.flatten()


def _chi2(a, b):
    return 0.5 * float(np.sum((a - b) ** 2 / (a + b + 1e-9)))

def detect_circles(shot):
    """检测顶部 ban 区圆形头像，返回 (left, right)，左右各 0-5 个（支持空 ban）。

    多档半径范围回退（17~110px），覆盖 720p 到 4K 手机截图的头像尺寸；
    按「两侧都检测满 5 个即停止」优先用较严格的小半径档，避免大半径档引入误检。
    """
    H, W = shot.shape[:2]
    gray = cv2.cvtColor(shot, cv2.COLOR_BGR2GRAY)
    top = gray[0:int(H*0.12), :]
    best_left, best_right = [], []
    for (md, p1, p2, mnr, mxr) in [
        (50, 100, 30, 18, 30),    # 常规小头像（720p/1080p）
        (40, 90, 22, 17, 32),
        (40, 80, 15, 15, 34),
        (70, 80, 15, 30, 60),     # 2K 高分屏
        (120, 80, 15, 55, 110),   # 4K 高分屏
    ]:
        circles = cv2.HoughCircles(top, cv2.HOUGH_GRADIENT, dp=1.2, minDist=md,
                                   param1=p1, param2=p2, minRadius=mnr, maxRadius=mxr)
        if circles is None:
            continue
        cs = np.uint16(np.around(circles[0]))
        left, right = [], []
        for c in cs:
            x, y, r = int(c[0]), int(c[1]), int(c[2])
            if r < mnr:
                continue
            if x < W*0.35:
                left.append((x, y, r))
            elif x > W*0.65:
                right.append((x, y, r))
        left = sorted(left, key=lambda c: c[0])[:5]
        right = sorted(right, key=lambda c: c[0])[-5:]
        if len(left) + len(right) > len(best_left) + len(best_right):
            best_left, best_right = left, right
        # 双方都检测满 5 个即可停止
        if len(left) >= 5 and len(right) >= 5:
            break
    return best_left, best_right


def has_lock(shot, cx, cy, r):
    """判断头像下沿是否有灰白色挂锁（被禁英雄有锁，空 ban 位无锁）。

    只查头像下沿以下区域，排除头像自身的白色内容干扰。
    注：曾尝试美工抠图锁模板形状匹配，但它在真实截图上易漏检锁（把有锁误判为空 ban），
    故改回更宽松的灰白像素计数启发式（配合 use_lock>=2 兜底，对旧 UI 更稳）。"""
    H, W = shot.shape[:2]
    hsv = cv2.cvtColor(shot, cv2.COLOR_BGR2HSV)
    s = hsv[:, :, 1]
    v = hsv[:, :, 2]
    y0 = max(0, int(cy + r + 1))
    y1 = min(H, int(cy + r + 18))
    x0 = max(0, int(cx - r))
    x1 = min(W, int(cx + r))
    region = (s[y0:y1, x0:x1] < 70) & (v[y0:y1, x0:x1] > 150)
    return int(region.sum()) > 50


def validate_row(circles):
    """用「同一高度 + 等距」校验一行 ban 头像，过滤误检的圆。
    若 y 方差大（不是一行，如旧 UI 散乱布局）则不做过滤，原样返回。"""
    if len(circles) <= 2:
        return circles
    circles = sorted(circles, key=lambda c: c[0])
    ys = [c[1] for c in circles]
    if float(np.std(ys)) > 20:
        return circles  # 不是一行，跳过校验
    med_y = float(np.median(ys))
    med_r = float(np.median([c[2] for c in circles]))
    # 同一高度：y 偏离中位超过 0.8r 的剔除
    row = [c for c in circles if abs(c[1] - med_y) <= med_r * 0.8]
    if len(row) <= 2:
        return row
    # 等距：间距偏离中位间距超过 60% 的剔除（保留首尾）
    xs = [c[0] for c in row]
    gaps = [xs[i + 1] - xs[i] for i in range(len(xs) - 1)]
    med_gap = float(np.median(gaps))
    keep = [row[0]]
    for i in range(1, len(row) - 1):
        left_gap = row[i][0] - row[i - 1][0]
        right_gap = row[i + 1][0] - row[i][0]
        if abs(left_gap - med_gap) <= med_gap * 0.6 and abs(right_gap - med_gap) <= med_gap * 0.6:
            keep.append(row[i])
    keep.append(row[-1])
    return keep


def recognize_bans_llm(shot, api_key, model='Qwen/Qwen3-VL-32B-Instruct'):
    """调用硅基流动多模态大模型识别 ban 位英雄名，返回 {blue: [名], red: [名]}。"""
    _, buf = cv2.imencode('.jpg', shot, [cv2.IMWRITE_JPEG_QUALITY, 90])
    b64 = base64.b64encode(buf).decode('ascii')
    prompt = (
        '这是《王者荣耀》ban 阶段结束的截图。请识别左右两侧被禁用的英雄：\n'
        '左侧是蓝方（我方）5 个 ban 位，右侧是红方（敌方）5 个 ban 位。\n'
        '有些位置可能是空 ban（没有禁用任何英雄）。\n'
        '请只返回 JSON，不要任何其它文字，格式：\n'
        '{"blue": ["英雄名", ...], "red": ["英雄名", ...]}\n'
        '英雄名用中文；空 ban 用空字符串 ""。蓝方和红方各固定 5 项。'
    )
    payload = {
        'model': model,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + b64}},
                {'type': 'text', 'text': prompt},
            ],
        }],
        'temperature': 0.1,
    }
    req = urllib.request.Request(
        'https://api.siliconflow.cn/v1/chat/completions',
        data=json.dumps(payload).encode('utf-8'),
        headers={'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    content = data['choices'][0]['message']['content'].strip()
    # 提取 JSON（可能被 markdown 代码块包裹）
    if '```' in content:
        content = content.split('```')[1]
        if content.startswith('json'):
            content = content[4:]
    content = content.strip()
    return json.loads(content)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': '缺少截图路径'}))
        return
    shot = imread_unicode(sys.argv[1])
    if shot is None:
        print(json.dumps({'error': '无法读取截图'}))
        return
    H, W = shot.shape[:2]

    manifest = json.load(open('avatars/manifest.json', encoding='utf-8'))
    name_by_id = {m['id']: m['name'] for m in manifest}
    id_by_name = {m['name']: m['id'] for m in manifest}

    # 多模态大模型识别：实测 Qwen-VL 对游戏头像识别率低（官方高清头像仅约 2-3/8，
    # 截图小头像几乎全错），远不如 ORB 官方头像模板匹配。因此默认走 ORB。
    # 仅当显式设置 RECOGNIZE_ENGINE=llm 且配置了 SILICONFLOW_API_KEY 时才启用（失败回退 ORB）。
    api_key = os.environ.get('SILICONFLOW_API_KEY', '')
    if api_key and os.environ.get('RECOGNIZE_ENGINE', '') == 'llm':
        try:
            llm = recognize_bans_llm(shot, api_key)
            left, right = detect_circles(shot)
            left = validate_row(left)
            right = validate_row(right)
            blue_names = llm.get('blue', [])
            red_names = llm.get('red', [])
            results = []
            for i, (cx, cy, r) in enumerate(left):
                nm = blue_names[i].strip() if i < len(blue_names) else ''
                results.append({'label': '我方%d' % (i + 1), 'hero_id': id_by_name.get(nm, ''),
                                'name': nm or None, 'score': 0, 'candidates': [], 'pos': [cx, cy, r]})
            for i, (cx, cy, r) in enumerate(right):
                nm = red_names[i].strip() if i < len(red_names) else ''
                results.append({'label': '敌方%d' % (i + 1), 'hero_id': id_by_name.get(nm, ''),
                                'name': nm or None, 'score': 0, 'candidates': [], 'pos': [cx, cy, r]})
            print(json.dumps({'results': results, 'width': W, 'height': H, 'engine': 'llm'}))
            return
        except Exception as e:
            sys.stderr.write('[llm] 多模态识别失败，回退 ORB：%s\n' % e)

    orb = cv2.ORB_create(nfeatures=1000)
    av_des = {}
    av_col = {}
    for m in manifest:
        raw = imread_unicode('avatars/%s.jpg' % m['id'])
        av = circular(raw, 48)
        kp, des = orb.detectAndCompute(av, None)
        if des is not None:
            av_des[m['id']] = des
        av_col[m['id']] = _color_hist(raw)
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)

    # 加载云端修正样本，扩充参考集（每个英雄可能有多张在游戏内截取的参考图）
    sample_des = {}
    for s in fetch_training_samples():
        try:
            img = cv2.imdecode(np.frombuffer(base64.b64decode(s['image_b64']), np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                continue
            av = circular(img, 48)
            kp, des = orb.detectAndCompute(av, None)
            if des is not None:
                sample_des.setdefault(s['hero_id'], []).append(des)
        except Exception:
            continue

    def _match_score(qdes, des):
        ms = bf.knnMatch(qdes, des, k=2)
        return len([m for m, n in ms if m.distance < 0.75 * n.distance])

    def recognize(cx, cy, r, use_color=True):
        sz = int(r * 2.2)
        x = max(0, cx - sz // 2); y = max(0, cy - sz // 2)
        x = min(x, W - sz); y = min(y, H - sz)
        crop = shot[y:y+sz, x:x+sz]
        q = circular(crop, sz)
        kp, qdes = orb.detectAndCompute(q, None)
        if qdes is None:
            return []
        heroes = list(av_des.keys())
        orb_score = {hid: _match_score(qdes, av_des[hid]) for hid in heroes}
        # 注：训练样本回灌在此处暂不参与 ORB 匹配（样本多了噪声大、会盖过官方头像）。
        # 样本仍在持续采集，供后续深度学习训练使用。
        # 旧 UI 头像配色与当前官方头像对不上，颜色信号不可靠，故仅在「检测到锁」的新 UI 上启用颜色融合。
        if not use_color:
            return sorted(orb_score.items(), key=lambda x: -x[1])
        # 颜色直方图 + ORB 倒数排名融合（RRF）：缓解「铠/关羽」这类 ORB 特征相似导致的混淆。
        qcol = _color_hist(crop)
        col_dist = {hid: _chi2(qcol, av_col[hid]) for hid in heroes}
        K, W_COL = 60, 2.0
        orb_rank = {h: j + 1 for j, (h, s) in enumerate(sorted(orb_score.items(), key=lambda kv: -kv[1]))}
        col_rank = {h: j + 1 for j, (h, d) in enumerate(sorted(col_dist.items(), key=lambda kv: kv[1]))}
        best_possible = 1.0 / (K + 1) + W_COL / (K + 1)
        scores = []
        for h in heroes:
            rrf = 1.0 / (K + orb_rank[h]) + W_COL / (K + col_rank[h])
            scores.append((h, round(100.0 * rrf / best_possible, 1)))
        scores.sort(key=lambda x: -x[1])
        return scores

    left, right = detect_circles(shot)
    left = validate_row(left)
    right = validate_row(right)
    if len(left) + len(right) == 0:
        print(json.dumps({'error': '未识别到任何 ban 头像（请确认是 ban 阶段结束的截图）'}))
        return

    # 左侧为蓝方（我方视角固定左侧），右侧为红方；各 0-5 个，支持空 ban
    # 同一阵营内英雄不可重复 ban（盲 ban 只允许双方撞同一个英雄），这里做去重
    results = []
    used = {'left': set(), 'right': set()}

    # 锁验证仅在「检测到锁」时启用（旧版 UI 无锁时回退为全部识别，避免误判为空）
    all_circles = left + right
    use_lock = sum(1 for (cx, cy, r) in all_circles if has_lock(shot, cx, cy, r)) >= 2

    for side_key, circles_list in [('left', left), ('right', right)]:
        for idx, (cx, cy, r) in enumerate(circles_list):
            label = ('我方' if side_key == 'left' else '敌方') + str(idx + 1)
            # 锁验证：无灰白锁 = 空 ban（不识别）
            scores = recognize(cx, cy, r, use_color=use_lock) if (not use_lock or has_lock(shot, cx, cy, r)) else []
            # 选第一个未被本方使用过的英雄（避免同一阵营重复）
            top = None
            for h, s in scores:
                if h not in used[side_key]:
                    top = (h, s)
                    break
            if top is None:
                top = (scores[0][0], scores[0][1]) if scores else (None, 0)
            if top[0]:
                used[side_key].add(top[0])
            candidates = [{'id': h, 'name': name_by_id.get(h, h), 'score': s} for h, s in scores[:5]]
            results.append({
                'label': label,
                'hero_id': top[0],
                'name': name_by_id.get(top[0], top[0]) if top[0] else None,
                'score': top[1],
                'candidates': candidates,
                'pos': [cx, cy, r],
            })

    print(json.dumps({'results': results, 'width': W, 'height': H}))

if __name__ == '__main__':
    main()
