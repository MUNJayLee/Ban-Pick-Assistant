# 测试报告 · 2026-10-29 晚间（v3.0 真机帧金标准 + 新端点 + 边界 + 性能）

> 测试小鱼（test-fish）｜2026-10-29 20:15
> 基线代码：`3125702 perf(recognize): warm_up 改用真实头像...`
> 测试范围：**只改测试文件**，未改动任何业务代码；用户 42 条核对数据（`_diag/review.json`）全程只读、测试后 SHA 校验一致。

---

## 1. 交付物

| 文件 | 说明 | 用例数 |
|---|---|---|
| `scripts/_test_real_frames.py` | 真机帧**金标准断言**（用户 42 条标注）+ 全量扫描模式 | 51（42 条标注全覆盖） |
| `scripts/_test_api.py` | API 端点验证（原 27 → 93，新增 6 个 review 端点/安全/边界） | 93 |
| `scripts/_test_boundary.py` **新增** | 识别函数边界/健壮性（空帧/损坏/超小/None/越界） | 34 |
| `scripts/_test_benchmark.py` **新增** | 性能基准（冷启动/稳态/API），写 `_diag/benchmark.json` | 10 组采样 |
| `scripts/_test_frontend.mjs` | 前端运行时（原 15 → 19，新增核对页 + API 断开容错） | 19 |

所有测试均可独立运行：API 服务未启动时打印启动指引并以退出码 2 结束；前端测试会先检查 5173/8900/Edge 环境，未就绪给清晰提示。

---

## 2. 最终回归结果（基线 3125702）

| 套件 | 结果 | 说明 |
|---|---|---|
| `_test_real_frames.py` | **51 项：PASS 45 / XFAIL 6 / FAIL 0** | 6 个 XFAIL 均为用户纠正英雄名（KI-2），无回归 |
| `_test_api.py --base :8902` | **93 项：PASS 90 / XFAIL 3 / FAIL 0** | 剩余 3 个已知问题见 §5 |
| `_test_boundary.py` | **34 项：PASS 34 / FAIL 0** | 全部通过 |
| `_test_frontend.mjs` | **19 项：PASS 19 / FAIL 0** | 含 API 断开容错 |
| `_test_recognize.py --bans`（Lead 指定） | **13 / 13 PASS** | 回归无退化 |
| `_test_recognize.py --picks`（Lead 指定） | **17 / 17 PASS** | c9 分路图标：0 个高置信假英雄 |
| 性能基准 `_test_benchmark.py` | **全部预算达标** | §6 |

> 说明：20:08 的一次运行中 `ban_row_filter` 曾短暂出现旧模板行为（3 FAIL），随后两次复跑均 PASS；
> 判定为提交/进程重启期间的瞬时环境态，非代码回归（当前基线可稳定复现 PASS）。

---

## 3. 用户 42 条核对标注 → 金标准（核心 P0）

`_diag/review.json` 共 42 条（22 正确 / 20 错误），按备注语义分成 4 类断言：

| 类别 | 条数 | 断言 | 当前结果 |
|---|---|---|---|
| ① 用户核对正确 → 冻结回归基线 | 22 | 识别 hero_id 必须与用户确认值一致 | **22/22 PASS** |
| ② 用户✗+备注正确英雄 | 6 | 识别 hero_id 必须 == 备注英雄 | **6 XFAIL**（KI-2，识别器未修） |
| ③ 用户备注「未选择，实则是…标志」 | 3 | 不能识别为英雄（empty 或 lane_icon） | **3/3 PASS** |
| ④ 用户✗无备注、测试小鱼看图补充 | 5 | 分路图标/段位徽章，不能识别为英雄 | **5/5 PASS** |
| ⑤ 非 BP 帧（游戏内）标注 | 6 | 不适用：要求 detect_bp() 判非 BP，pick 结果不被管线消费 | **6/6 PASS** |

附加回归守卫：
- **ban 行过滤**（3 帧）：`recognize_bans(skip_lane_icons=True)` 不得删真实 ban —— PASS
- **裁切几何**（3 帧）：用户备注「裁切框偏右」的 B5 位，裁切中心与 B1~B4 等距外推偏差 ≤4px —— PASS（修复前约 7px，修复后 3~3.5px）

对照：修复前同一套金标准为 **PASS 31 / XFAIL 20 / FAIL 0**，修复后 **PASS 45 / XFAIL 6**，20 项 XFAIL 中 14 项转 PASS（KI-1 8 项 + KI-4 3 项 + KI-5 3 项），其余 6 项为英雄名准确率（KI-2）。

---

## 4. 本次测试发现并已修复的问题

| # | 问题 | 证据/根因 | 修复 |
|---|---|---|---|
| 1 | **分路图标模板张冠李戴（P0）** | 旧 `assets/lane_icons/lane_top/mid/adc.png` 实为 **ban 行英雄头像**（B3=盾山）。导致 `recognize_bans(skip_lane_icons=True)` 误删真实 ban：selecting_234229 10→7、pick_235855 10→8、ban_234153 3→1；`/api/review/crop` 把真实 ban 盾山返回成空 | recognize-fish `1533dcc`：换成真正分路图标/未选择徽章模板（11 个，取自 pick 位），`recognize_picks` 增加 `skip_lane_icons`（默认开）→ 未选择位标记 `empty+lane_icon` |
| 2 | **选人界面分路图标被当英雄** | 用户标注 `selecting_234229 B3/B4/B5`、`selecting_234213 B1~B5`（共 8 处）被识别成猪八戒/刘禅/亚瑟/安琪拉等 | 同上（recognize_picks 分路图标过滤），金标准 8 项 XFAIL→PASS |
| 3 | **核对页裁切「偏右」** | `api_server._slot_positions` 未同步 `recognize_bans` 的 -2px 圆心微调与中位数半径：B5 cx=374/r=20 → 裁切切边、偏右约 3~7px | Lead `8dda13b` 同步坐标；金标准裁切几何 3 项由 XFAIL→PASS |
| 4 | **冷启动回归 19s** | recognize-fish `1533dcc` 的 `warm_up` 用随机噪声图预热 ORB（数百关键点 × knnMatch），FeatureBank 建库 19~25s | Lead `3125702`：warm_up 改用 1 个真实头像（约 236ms），`FeatureBank(warm=False)` 默认不预热；实测建库 774ms、warm_up 236ms |

---

## 5. 仍存在的已知问题（XFAIL，不阻塞 CI）

| ID | 问题 | 影响 | 位置/建议 |
|---|---|---|---|
| **KI-2** | 6 个英雄名/变体识别错误：赵云（实为东皇太一）、元流之子坦克（识为百里守约/元流之子法师）、钟馗（识为云中君）、不知火舞（识为兰陵王）、孙尚香（识为王维） | 选人阶段预选英雄名不准（均已标低置信 `confident=False`） | 头像库样本/低分辨率头像（ban 位有效分辨率仅约 46px）。recognize-fish 已分析：自适应降权可稳定个别案例但会拉低整体高置信数，建议扩大标注集后再调 |
| **KI-1（API 层）** | `/api/review/crop` 的 `kind=pick` 分支未透传 `recognize_picks` 已返回的 `lane_icon` 字段 | 核对页对未选择位显示「（空）」而非「分路图标」（识别本身已正确返回 empty） | `api_server.api_review_crop` pick 分支加一行：`lane_icon = bool(pp.get('lane_icon'))`（前端已支持显示） |
| **KI-6** | `/api/review/frame_raw` 仅防路径穿越，未限制扩展名 | `_diag` 下任意文件（如 `review.json`）可被当 `image/png` 下载 | 建议白名单 `live_*.png` |
| **KI-7** | 0 字节帧触发未捕获 `cv2.error` → 500 纯文本 | 服务不崩溃，但错误不友好（非 PNG 损坏帧已是 500 + JSON detail） | `imread_unicode` 外层包 try/except → 400 JSON |

**观察项（记录实际行为，未判失败）**：`/api/review/frames?limit=-1` 少返回最后一帧（应校验 limit≥0）；`crop.kind` 未校验（未知值按 pick 处理）；`POST /api/review/mark` 不校验帧是否存在（幽灵标注会进统计）；`export?format=xml` 回落为 JSON。

---

## 6. 性能基准（`_diag/benchmark.json`，CPU 空闲时）

| 项目 | 数值（median） | 预算 | 结论 |
|---|---|---|---|
| FeatureBank 初始化（warm=False，133 英雄） | 774 ms | <3000 | ✅ |
| **warm_up 预热**（真实头像 1 个 + Hough + 模板） | **236 ms** | <1000 | ✅ |
| **首批 recognize_bans（预热后）** | **80 ms** | — | ✅ 冷启动开销已消除 |
| recognize_bans 稳态（ban 帧） | 69 ms | <800 | ✅ |
| recognize_bans（selecting 帧，10 ban） | 247 ms | — | ✅ |
| recognize_picks（selecting 帧，含分路过滤） | 357 ms | — | ✅ |
| recognize_picks（final 帧，10 英雄） | 1013 ms | <1500 | ✅ |
| detect_bp / detect_phase_fast | 30 ms / 5 ms | — | ✅ |
| API health / state | 4.6 / 4.4 ms | <300 | ✅ |
| API review/frames / summary | 60 / 55 ms | <1000 | ✅ |
| API review/crop（ban / pick） | 123 / 953 ms | <1500 | ✅ |
| API review/export / marks / frame_raw | 5.6~17 ms | — | ✅ |

> 注：`recognize_picks` 的耗时主要来自 10 个头像 × 133 英雄 ORB 匹配；warm_up 只消除首次调用的额外开销，不改变稳态算法成本。

---

## 7. 如何运行

```bash
# 1) 识别金标准（最快，约 6s，无需服务）
python scripts/_test_real_frames.py

# 2) API（默认 8900；验收新代码可另起 8902 避免打断现场）
python scripts/api_server.py --port 8902
python scripts/_test_api.py --base http://127.0.0.1:8902

# 3) 边界 / 性能
python scripts/_test_boundary.py
python scripts/_test_benchmark.py --base http://127.0.0.1:8902   # 写 _diag/benchmark.json

# 4) 前端（需 vite 5173 + API 8900 + Edge）
node scripts/_test_frontend.mjs
```

**数据安全**：`_test_api.py` 会临时写入 1~2 条标注验证 `POST /api/review/mark`，结束后「只删除本次注入的 key 再写回」，
保留用户在测试期间新增的标注；并校验原有 42 条标注逐条不变（本次实测 SHA-256 `4ab18eda…` 前后一致）。

---

## 8. 建议与后续

1. **KI-1 接线**：`api_review_crop` pick 分支透传 `lane_icon`（一行），核对页即可把 234213/234229 的未选择位显示为「分路图标」。
2. **KI-2**：优先补 `avatars/` 中赵云、钟馗、不知火舞、孙尚香、元流之子各形态的高质量样本；ban 位 46px 有效分辨率下 ORB 不稳定，可考虑 ban 位专用轻量分类器或颜色+ORB 自适应降权（需更大真机标注集验证）。
3. **核对数据继续积累**：当前 42 条已全部转为回归断言；后续用户新增标注只需在 `_test_real_frames.py` 的 `HERO_GOLD`/`NOT_HERO_GOLD` 补一条期望即可，覆盖率测试会校验「金标准 key 必须存在于 review.json」防止数据漂移。
4. **API 服务重启**：今日修复（真模板 / 裁切坐标）需重启 8900 服务才会在核对页生效；当前 8900 仍是旧进程（本次 API 回归在独立 8902 新进程上完成）。
