# 王者 BP 助手

实时辅助 BP（Ban/Pick）工具：**ADB 抓屏 → 自动识别 ban/pick → 智能推荐**。
集成天元之弈梯度数据，支持个人战绩追踪与对局复盘。

---

## 快速开始（v3.0）

### 环境要求
- Windows 10/11
- Python 3.11+
- Node.js 18+
- 手机开启「开发者选项 → USB 调试」

### 安装

```bash
# 前端依赖
npm install

# Python 依赖
python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 启动

```
双击 启动v3.0.bat        # 日常使用（无控制台窗口）
双击 调试启动.bat         # 测试用（能看到识别日志）
```

浏览器自动打开 http://localhost:5173/

### 使用

```
1. 左栏「设备」下拉选手机 → 点「开始识别」
2. 进游戏 BP → 看板自动填充 ban/pick，右侧推荐实时更新
3. BP 完成 → 自动建记录 + 自动标记「我的英雄」
4. 打完一局 → 结算界面自动回填胜负/MVP
```

详细测试清单见 [TEST_GUIDE.md](./TEST_GUIDE.md)。

---

## 架构（v3.0）

```
┌──────────────────────────────────────────────┐
│  React 前端 (:5173)                           │
│  左侧: ADB 实时画面 + 设备控制 + 识别状态      │
│  右侧: BP 看板 + 英雄池 + 智能推荐             │
└────────────────────┬─────────────────────────┘
                     │ HTTP + WebSocket
┌────────────────────▼─────────────────────────┐
│  Python API (:8900, FastAPI)                 │
│  · ADB 抓屏    · OCR 阶段识别                 │
│  · ban/pick 识别 · 玩家楼层识别               │
│  · 结算识别    · 数据同步                     │
└──────────────────────────────────────────────┘
```

**识别能力**：

| 能力 | 方法 | 实测 |
|---|---|---|
| BP 阶段 | OCR 顶部横幅 + 帧差缓存 | 10/10，缓存后 0.001s |
| ban 位 | HoughCircles + ORB/颜色融合 | 真机 10/10 |
| pick 位 | 固定比例坐标 + 空位判断 | 8/10（倒计时位低置信） |
| 玩家楼层 | OCR 名字 + 金色像素比例 | 3/4 |
| 结算结果 | OCR 巅峰积分变化符号 | WIN/MVP/delta 全对 |
| 玩家英雄 | 结算 MVP 圆形头像 | MVP 画面准确 |

---

## 功能特性

- **实时 BP 识别**：自动填充 ban/pick，无需手动导入
- **智能推荐**：根据克制关系、梯度评分、位置缺口实时推荐
- **个人战绩**：自动识别「我的英雄」+ 对局评分/MVP/奖牌
- **对局复盘**：记录页支持筛选、删除、评分统计
- **数据看板**：胜率、反馈率、我的英雄实际胜率
- **手动修正**：点任意 ban/pick 位可手动改，ADB 不覆盖

---

## 技术栈

- **前端**：React 18 + TypeScript + Tailwind CSS + Vite + Zustand
- **桌面端（可选）**：Tauri v2（Rust）
- **识别服务**：Python + FastAPI + OpenCV + RapidOCR
- **数据源**：天元之弈（tianyuanzhiyi.com）
- **后端同步**：Supabase

---

## 目录结构

```
.
├── scripts/
│   ├── api_server.py          # v3.0 FastAPI 服务
│   ├── live_recognize.py      # 识别核心（阶段/ban/pick/楼层/结算）
│   ├── recognize_screenshot.py# 圆形检测 + 头像裁剪 + 锁检测
│   ├── live_bp.py             # 命令行实时识别（调试用）
│   ├── adb_console.py         # v2.0 tkinter GUI（保留）
│   ├── sync_heroes.py         # 英雄数据同步
│   └── ...
├── src/
│   ├── pages/Home.tsx         # 主界面（左栏 ADB + 右栏 BP）
│   ├── components/            # BpStage / AdbControlPanel / AdbPreview ...
│   ├── hooks/useBpSync.ts     # ADB 结果 → bpStore 同步
│   ├── store/bpStore.ts       # BP 状态
│   └── services/recommendation/  # 推荐算法
├── models/templates/          # 阶段识别模板
├── avatars/                   # 133 英雄头像（gitignore，用 sync_heroes.py 重建）
├── training_data/             # 样本采集（含金标准批次）
├── 启动v3.0.bat               # 一键启动
├── 调试启动.bat               # 带日志的启动
└── TEST_GUIDE.md              # 测试清单
```

---

## 已知限制

| 限制 | 说明 |
|---|---|
| 玩家楼层识别 3/4 | 「感谢帮抢」等聊天消息会干扰 OCR 分行 |
| 排位局楼层不适用 | 排位我方名字是白色，只对巅峰赛（金色）有效 |
| 非 MVP 结算无玩家头像 | 「我的英雄」需手动确认（我方 5 个一键点选） |
| 倒计时中的 pick 位 | 可能识别偏差，等「最后调整」阶段自动修正 |
| 巅峰赛无常规评分 | 评分字段供手动填写 / 排位赛使用 |

---

## 版本历史

- **v3.0**（当前）：统一 Web 控制台 + ADB 实时识别接入 + 全链路闭环
- **v2.0**：ADB 识别 + GUI 控制台 + 样本采集（tag: v2.0）
- **v1.0**：基础 BP 模拟 + 推荐（tag: v1.0）
