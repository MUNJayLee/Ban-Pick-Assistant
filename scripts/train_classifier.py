# -*- coding: utf-8 -*-
"""
王者BP助手 · 英雄头像分类器（MobileNetV2 迁移学习）
=====================================================================
数据来源：
  1. 官方头像 avatars/*.jpg（132 张，每类 1 张，基础参考）
  2. 云端修正样本 training_samples（游戏内头像，泛化关键，但量少且不平衡）

关键设计：官方头像就是游戏内 ban 头像的高清原图。游戏内头像 ≈ 官方头像经过
「降采样 + 圆形裁剪 + 深色背景 + 底部挂锁」的变换。因此训练时用强数据增强
模拟这些变换，让模型能从「每类 1 张官方头像」泛化到「游戏内降采样头像」。

流程：
  train  训练（需 torch）  python scripts/train_classifier.py train
  export 导出 ONNX         python scripts/train_classifier.py export
  eval   用测试截图评估     python scripts/train_classifier.py eval <截图路径>
  demo   单图演示           python scripts/train_classifier.py demo

推理端无需 torch：cv2.dnn 直接读 ONNX。
"""
import sys
import os
import json
import base64
import urllib.request
import random

import numpy as np
import cv2

SUPABASE_URL = 'https://nvgvaphzhqgsbxqrfoyb.supabase.co'
PUBLISHABLE_KEY = 'sb_publishable_DJHwKetxg1LHNFdwlhF6jA_eQ88lwaZ'

INPUT_SIZE = 96
NUM_CLASSES = 132
MODEL_PATH = 'models/hero_classifier.onnx'
CLASSES_PATH = 'models/hero_classes.json'
LOCK_PATH = 'models/lock_cutout.png'


# ---------------------------------------------------------------------------
# 1) 数据加载
# ---------------------------------------------------------------------------
def imread_unicode(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def load_manifest():
    manifest = json.load(open('avatars/manifest.json', encoding='utf-8'))
    return [m['id'] for m in manifest], {m['id']: i for i, m in enumerate(manifest)}


def fetch_training_samples():
    """从 Supabase 拉取修正样本，返回 [(hero_id, BGR ndarray)]。"""
    url = SUPABASE_URL + '/rest/v1/training_samples?select=hero_id,image_b64&limit=20000'
    req = urllib.request.Request(url, headers={'apikey': PUBLISHABLE_KEY})
    out = []
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            samples = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print('[data] 拉取样本失败：', e)
        return out
    for s in samples:
        try:
            img = cv2.imdecode(np.frombuffer(base64.b64decode(s['image_b64']), np.uint8), cv2.IMREAD_COLOR)
            if img is not None:
                out.append((s['hero_id'], img))
        except Exception:
            continue
    return out


# ---------------------------------------------------------------------------
# 2) 数据增强：模拟「游戏内 ban 头像」的变换
# ---------------------------------------------------------------------------
def _load_lock_mask(size):
    """返回缩放到头像底部合适大小的锁形状二值掩码（0/255）。"""
    if not os.path.exists(LOCK_PATH):
        return None
    img = cv2.imdecode(np.fromfile(LOCK_PATH, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None or img.shape[-1] < 4:
        return None
    alpha = img[:, :, 3]
    ys, xs = np.where(alpha > 0)
    if len(ys) == 0:
        return None
    tpl = alpha[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    # 锁宽约为头像宽的 0.33
    tw = max(8, int(size * 0.33))
    th = max(8, int(round(tw * tpl.shape[0] / tpl.shape[1])))
    return (cv2.resize(tpl, (tw, th), interpolation=cv2.INTER_AREA) > 128).astype(np.uint8)


def _add_lock(img, lock_mask):
    """把锁形状（白色）叠加到头像底部。"""
    if lock_mask is None:
        return img
    H, W = img.shape[:2]
    lh, lw = lock_mask.shape
    x0 = (W - lw) // 2
    y0 = H - lh - int(H * 0.03)
    x0 = max(0, min(x0, W - lw))
    y0 = max(0, min(y0, H - lh))
    m = lock_mask > 0
    roi = img[y0:y0 + lh, x0:x0 + lw]
    roi[m] = (235, 235, 235)  # 灰白金属锁
    img[y0:y0 + lh, x0:x0 + lw] = roi
    return img


def _gameshot_augment(img, lock_mask):
    """把官方头像增强成「游戏内 ban 头像」的近似（温和，避免破坏判别特征）。"""
    H, W = img.shape[:2]
    # 1) 随机降采样再放大（温和，模拟游戏内头像的轻度模糊）
    if random.random() < 0.7:
        s = random.uniform(0.6, 0.85)
        img = cv2.resize(img, (max(20, int(W * s)), max(20, int(H * s))))
        img = cv2.resize(img, (W, H))
    # 2) 随机旋转 + 缩放 + 平移（温和）
    angle = random.uniform(-10, 10)
    scale = random.uniform(0.9, 1.1)
    M = cv2.getRotationMatrix2D((W / 2, H / 2), angle, scale)
    M[0, 2] += random.uniform(-0.04, 0.04) * W
    M[1, 2] += random.uniform(-0.04, 0.04) * H
    img = cv2.warpAffine(img, M, (W, H), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    # 3) 圆形裁剪 + 深色背景（模拟 ban 栏背景）
    mask = np.zeros((H, W), dtype=np.uint8)
    cv2.circle(mask, (W // 2, H // 2), int(W * 0.47), 255, -1)
    bg = np.full_like(img, (22, 16, 32))
    img = np.where(mask[..., None] > 0, img, bg)
    # 4) 加锁（40% 概率，模拟被禁英雄）
    if lock_mask is not None and random.random() < 0.4:
        img = _add_lock(img, lock_mask)
    # 5) 色彩抖动 + 噪声（温和）
    if random.random() < 0.6:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[:, :, 1] *= random.uniform(0.9, 1.1)
        hsv[:, :, 2] *= random.uniform(0.9, 1.1)
        hsv = np.clip(hsv, 0, 255).astype(np.uint8)
        img = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    if random.random() < 0.3:
        noise = np.random.normal(0, random.uniform(2, 5), img.shape)
        img = np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    return img


# ---------------------------------------------------------------------------
# 3) 模型 + 训练（需要 torch）
# ---------------------------------------------------------------------------
def train():
    try:
        import torch
        import torch.nn as nn
        import torch.optim as optim
        from torch.utils.data import Dataset, DataLoader
        from torchvision import models
    except ImportError:
        print('[train] 缺少 torch/torchvision，请先安装：')
        print('  pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu')
        return

    ids, id2idx = load_manifest()
    # 官方头像（每类至少 1 张）+ 云端修正样本（游戏内头像）
    imgs, labels = [], []
    for hid in ids:
        p = 'avatars/%s.jpg' % hid
        if os.path.exists(p):
            img = imread_unicode(p)
            if img is not None:
                imgs.append(img)
                labels.append(id2idx[hid])
    n_official = len(imgs)
    samples = fetch_training_samples()
    for hid, img in samples:
        if hid in id2idx:
            imgs.append(img)
            labels.append(id2idx[hid])
    n_samples = len(imgs) - n_official
    print('[train] 数据：官方头像 %d + 修正样本 %d = %d 张，覆盖类别 %d' % (
        n_official, n_samples, len(imgs), len(set(labels))))

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print('[train] 设备：', device)
    lock_mask = _load_lock_mask(INPUT_SIZE)

    class AvatarDataset(Dataset):
        def __init__(self, imgs, labels, augment):
            self.imgs = imgs
            self.labels = labels
            self.augment = augment

        def __len__(self):
            return len(self.imgs)

        def __getitem__(self, i):
            img = self.imgs[i].copy()
            if self.augment and random.random() < 0.7:
                img = _gameshot_augment(img, lock_mask)
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            img = cv2.resize(img, (INPUT_SIZE, INPUT_SIZE))
            img = (img.astype(np.float32) / 255.0 - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225])
            x = torch.from_numpy(img.transpose(2, 0, 1).astype(np.float32))
            return x, self.labels[i]

    # 训练用全量数据（增强），验证从训练集里单独留一部分官方头像评估拟合情况
    n = len(imgs)
    n_val = max(1, int(n_official * 0.15))
    indices = list(range(n))
    random.shuffle(indices)
    # 验证集优先取自官方头像（干净，评估对官方头像的拟合），游戏内样本全进训练
    official_idx = list(range(n_official))
    random.shuffle(official_idx)
    val_idx = set(official_idx[:n_val])
    train_idx = [i for i in range(n) if i not in val_idx]
    train_ds = AvatarDataset([imgs[i] for i in train_idx], [labels[i] for i in train_idx], augment=True)
    val_ds = AvatarDataset([imgs[i] for i in val_idx], [labels[i] for i in val_idx], augment=False)
    train_dl = DataLoader(train_ds, batch_size=32, shuffle=True, num_workers=0)
    val_dl = DataLoader(val_ds, batch_size=32, num_workers=0)

    model = models.mobilenet_v2(pretrained=True)
    model.classifier[1] = nn.Linear(model.last_channel, NUM_CLASSES)
    model.to(device)

    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=1e-3)
    epochs = 30

    print('[train] 开始训练 %d 轮（每轮增强会随机变化）...' % epochs)
    best_v = 0.0
    for ep in range(epochs):
        model.train()
        total, correct = 0, 0
        for x, y in train_dl:
            x, y = x.to(device), y.to(device)
            optimizer.zero_grad()
            out = model(x)
            loss = criterion(out, y)
            loss.backward()
            optimizer.step()
            total += y.size(0)
            correct += (out.argmax(1) == y).sum().item()
        model.eval()
        v_total = v_correct = 0
        with torch.no_grad():
            for x, y in val_dl:
                x, y = x.to(device), y.to(device)
                v_correct += (model(x).argmax(1) == y).sum().item()
                v_total += y.size(0)
        v_acc = 100 * v_correct / v_total
        if v_acc > best_v:
            best_v = v_acc
        print('  epoch %2d  训练acc %.1f%%  验证acc %.1f%%' % (ep + 1, 100 * correct / total, v_acc))

    os.makedirs('models', exist_ok=True)
    torch.save(model.state_dict(), 'models/hero_classifier.pth')
    json.dump(ids, open(CLASSES_PATH, 'w', encoding='utf-8'), ensure_ascii=False)
    print('[train] 已保存 models/hero_classifier.pth（验证最好 %.1f%%）' % best_v)
    print('[train] 下一步：python scripts/train_classifier.py export')


# ---------------------------------------------------------------------------
# 4) 导出 ONNX（供 cv2.dnn 推理，推理端无需 torch）
# ---------------------------------------------------------------------------
def export():
    try:
        import torch
        import torch.nn as nn
        from torchvision import models
    except ImportError:
        print('[export] 缺少 torch/torchvision。')
        return
    ids, _ = load_manifest()
    model = models.mobilenet_v2(pretrained=False)
    model.classifier[1] = nn.Linear(model.last_channel, NUM_CLASSES)
    state = 'models/hero_classifier.pth'
    if not os.path.exists(state):
        print('[export] 未找到权重 %s，请先运行 train。' % state)
        return
    model.load_state_dict(torch.load(state, map_location='cpu'))
    model.eval()
    dummy = torch.randn(1, 3, INPUT_SIZE, INPUT_SIZE)
    os.makedirs('models', exist_ok=True)
    torch.onnx.export(model, dummy, MODEL_PATH, input_names=['input'], output_names=['output'],
                      opset_version=12, dynamo=False)
    json.dump(ids, open(CLASSES_PATH, 'w', encoding='utf-8'), ensure_ascii=False)
    print('[export] 已导出 ONNX 到 %s' % MODEL_PATH)


# ---------------------------------------------------------------------------
# 5) cv2.dnn 推理
# ---------------------------------------------------------------------------
def load_onnx():
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError('未找到 %s，请先 train + export。' % MODEL_PATH)
    net = cv2.dnn.readNetFromONNX(MODEL_PATH)
    ids = json.load(open(CLASSES_PATH, encoding='utf-8'))
    return net, ids


def infer(net, ids, bgr_img):
    """对单张 BGR 头像分类，返回 [(hero_id, prob), ...] top5。"""
    blob = cv2.dnn.blobFromImage(bgr_img, 1.0 / 255.0, (INPUT_SIZE, INPUT_SIZE),
                                 (0.485, 0.456, 0.406), swapRB=True, crop=False)
    net.setInput(blob)
    probs = net.forward()[0]
    idx = np.argsort(probs)[::-1][:5]
    return [(ids[i], float(probs[i])) for i in idx]


def crop_avatar(shot, cx, cy, r, size=INPUT_SIZE):
    """从截图裁剪圆形头像，与训练端预处理一致（圆 mask + resize）。"""
    H, W = shot.shape[:2]
    sz = int(r * 2.2)
    x = max(0, min(W - sz, cx - sz // 2))
    y = max(0, min(H - sz, cy - sz // 2))
    crop = shot[y:y + sz, x:x + sz]
    img = cv2.resize(crop, (size, size))
    m = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(m, (size // 2, size // 2), size // 2, 255, -1)
    img = img.copy()
    img[m == 0] = 0
    return img


def eval_screenshot(path):
    """用 ONNX 模型对测试截图跑一遍，打印每个 ban 位的 top1（配合 recognize 对比）。"""
    try:
        net, ids = load_onnx()
    except Exception as e:
        print('[eval]', e)
        return
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import recognize_screenshot as R
    shot = R.imread_unicode(path)
    if shot is None:
        print('[eval] 无法读取截图')
        return
    left, right = R.detect_circles(shot)
    left = R.validate_row(left)
    right = R.validate_row(right)
    name_by_id = {m['id']: m['name'] for m in json.load(open('avatars/manifest.json', encoding='utf-8'))}
    for side, circles in [('蓝', left), ('红', right)]:
        for i, (cx, cy, r) in enumerate(circles):
            img = crop_avatar(shot, cx, cy, r)
            top = infer(net, ids, img)
            print('%s%d: %s (%.2f)' % (side, i + 1, name_by_id.get(top[0][0], top[0][0]), top[0][1]))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    if cmd == 'train':
        train()
    elif cmd == 'export':
        export()
    elif cmd == 'eval':
        if len(sys.argv) < 3:
            print('用法: python scripts/train_classifier.py eval <截图路径>')
            return
        eval_screenshot(sys.argv[2])
    elif cmd == 'demo':
        try:
            net, ids = load_onnx()
        except Exception as e:
            print('[demo]', e)
            return
        img = imread_unicode('avatars/kai.jpg')
        print('[demo] 铠头像 top5:', infer(net, ids, img))
    else:
        print('未知命令：', cmd)
        print(__doc__)


if __name__ == '__main__':
    main()
