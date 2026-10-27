# -*- coding: utf-8 -*-
"""定向判别器可行性验证：合成样本训练「易混淆英雄」少类分类器。

思路：全 132 类分类器因每类 1 张样本退化；但针对单个混淆簇（如关羽的混淆对象）
做少类分类，判别空间小，用「官方头像 + 游戏内变换」合成样本可能足够。
"""
import sys
import os
import json
import random

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recognize_screenshot as R
from train_classifier import _gameshot_augment, _load_lock_mask, INPUT_SIZE


def build_synthetic(hero_ids, per_class=150):
    """用官方头像 + 游戏内变换合成样本。返回 (imgs, labels)。"""
    lock_mask = _load_lock_mask(INPUT_SIZE)
    imgs, labels = [], []
    for idx, hid in enumerate(hero_ids):
        base = R.imread_unicode('avatars/%s.jpg' % hid)
        if base is None:
            print('缺头像', hid)
            continue
        for _ in range(per_class):
            img = _gameshot_augment(base.copy(), lock_mask)
            imgs.append(img)
            labels.append(idx)
    return imgs, labels


def crop_avatar(shot, cx, cy, r, size=INPUT_SIZE):
    H, W = shot.shape[:2]
    sz = int(r * 2.2)
    x = max(0, min(W - sz, cx - sz // 2))
    y = max(0, min(H - sz, cy - sz // 2))
    img = cv2.resize(shot[y:y + sz, x:x + sz], (size, size))
    return img


def main():
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import Dataset, DataLoader
    from torchvision import models

    # 关羽的混淆簇（ORB top 混淆 + 颜色 top 混淆）
    cluster = ['guanyu', 'houyi', 'cang', 'gongsunli', 'xiaoqiao']
    name_by_id = {m['id']: m['name'] for m in json.load(open('avatars/manifest.json', encoding='utf-8'))}
    print('混淆簇:', [name_by_id[h] for h in cluster])

    imgs, labels = build_synthetic(cluster, per_class=150)
    print('合成样本:', len(imgs), '张（每类 150）')

    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    class DS(Dataset):
        def __init__(self, imgs, labels):
            self.imgs = imgs
            self.labels = labels

        def __len__(self):
            return len(self.imgs)

        def __getitem__(self, i):
            img = cv2.cvtColor(self.imgs[i], cv2.COLOR_BGR2RGB)
            img = cv2.resize(img, (INPUT_SIZE, INPUT_SIZE))
            img = (img.astype(np.float32) / 255.0 - mean) / std
            return torch.from_numpy(img.transpose(2, 0, 1)), self.labels[i]

    # 训练集 / 验证集（合成样本随机切）
    n = len(imgs)
    idx = list(range(n))
    random.shuffle(idx)
    n_val = int(n * 0.2)
    val_idx = set(idx[:n_val])
    train_ds = DS([imgs[i] for i in idx if i not in val_idx], [labels[i] for i in idx if i not in val_idx])
    val_ds = DS([imgs[i] for i in val_idx], [labels[i] for i in val_idx])
    train_dl = DataLoader(train_ds, batch_size=32, shuffle=True)
    val_dl = DataLoader(val_ds, batch_size=32)

    device = torch.device('cpu')
    model = models.mobilenet_v2(pretrained=True)
    model.classifier[1] = nn.Linear(model.last_channel, len(cluster))
    model.to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=1e-3)

    print('训练 15 轮...')
    for ep in range(15):
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
        vt = vc = 0
        with torch.no_grad():
            for x, y in val_dl:
                x, y = x.to(device), y.to(device)
                vc += (model(x).argmax(1) == y).sum().item()
                vt += y.size(0)
        print('  epoch %2d  训练acc %.1f%%  合成验证acc %.1f%%' % (ep + 1, 100 * correct / total, 100 * vc / vt))

    # 评估真实截图：测试用例1 的红4（关羽）和 红1（铠，不在簇内，看会不会误判）
    print('\n=== 真实截图评估 ===')
    shot = R.imread_unicode(r'测试用例\62f73ca5e389165a91ac3fff2dab97a1.jpg')
    left, right = R.detect_circles(shot)
    left = R.validate_row(left)
    right = R.validate_row(right)
    # 期望：红4=关羽，其他位是簇外英雄（应低置信）
    truth = ['dunshan', 'donghuangtaiyi', 'yunyao', 'zhangliang', '', 'kai', 'dayu', 'zhangliang', 'guanyu', 'sunquan']
    allc = list(left) + list(right)
    labels = ['蓝1', '蓝2', '蓝3', '蓝4', '蓝5', '红1', '红2', '红3', '红4', '红5']
    model.eval()
    with torch.no_grad():
        for i, (cx, cy, r) in enumerate(allc):
            if not truth[i]:
                continue
            img = crop_avatar(shot, cx, cy, r)
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            rgb = cv2.resize(rgb, (INPUT_SIZE, INPUT_SIZE))
            t = torch.from_numpy(((rgb.astype(np.float32) / 255.0 - mean) / std).transpose(2, 0, 1)).unsqueeze(0)
            probs = torch.softmax(model(t), 1)[0]
            top = int(torch.argmax(probs))
            conf = float(probs[top])
            tag = '✓' if cluster[top] == truth[i] else '✗'
            print('  %s 期望%-8s => 判别器 %s (置信%.2f) %s' % (
                labels[i], name_by_id[truth[i]], name_by_id[cluster[top]], conf, tag))


if __name__ == '__main__':
    main()
