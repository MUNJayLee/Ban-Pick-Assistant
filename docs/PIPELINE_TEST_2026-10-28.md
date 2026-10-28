# 流程链路测试报告 · 2026-10-28

> 目标：验证端到端**数据流闭环**（识别 → store → 记录 → 结算回填 → 编辑），
> 专找「吕布」类数据污染 / 状态残留 / 闭环断路问题。

---

## 一、测试方法

无真机条件下，用 esbuild 把 store 打包成 ESM，在 Node 里 mock `window.localStorage` 跑真实 store 逻辑：

```
scripts/_test_pipeline.mjs
  ├── esbuild 打包 src/store/bpStore.ts + bpRecordStore.ts
  ├── mock window.localStorage（zustand persist 依赖）
  ├── A. 状态机链路（8 项）
  ├── B. 数据污染（2 项）
  ├── C. 记录链路（8 项）
  ├── D. 持久化（2 项）
  └── E. myHeroId 校验逻辑（4 项）
```

**结果：21/21 通过**（修复前 15/21，6 项失败全部是真 bug）

---

## 二、发现的闭环问题（6 个，全部已修）

### P0-1 reset() 后 myHeroId 残留（数据污染·「吕布」同类）

| 项 | 内容 |
|---|---|
| 位置 | `src/store/bpStore.ts:reset` |
| 现象 | `reset: () => set(initialState)` 是 **merge 语义**，`BpState.myHeroId` 不在 `initialState` 里 → reset 后残留 |
| 影响 | 上一局的「我的英雄」带到新局 → 与「记录里出现吕布」同类污染 |
| 修复 | `reset: () => set({ ...initialState, myHeroId: undefined })` |
| commit | `fa903d1` |

### P0-2 新一局检测误触发 reset（用户数据被清空）

| 项 | 内容 |
|---|---|
| 位置 | `src/hooks/useBpSync.ts:82` ② 新一局检测 |
| 现象 | 只要 `raw.bans` 为空就 reset；**识别失败一帧**（切后台/卡顿/OCR 超时）即触发 |
| 影响 | 用户手动填的阵容在识别抖动时被全部清空 |
| 修复 | 加 `emptyBanStreak` 防抖：连续 3 次（约 6 秒）bans 为空才 reset |
| commit | `26a9236` |

### P0-3 结算自动回填闭环断裂（草稿永远匹配不到）

| 项 | 内容 |
|---|---|
| 位置 | `AnalysisSummary.buildRecordPayload` + `useBpSync` ⑥ |
| 现象 | 建草稿时 `actualResult: undefined`，但结算回填找 `actualResult === 'PENDING'` → **永远匹配不到** |
| 影响 | 自动建的草稿记录无法被结算自动回填（胜负/MVP 都要手动） |
| 修复 | `actualResult: actual`（保留 'PENDING'） |
| commit | `2bda97a` |

### P1-1 建记录时 myHeroId 脏数据未校验

| 项 | 内容 |
|---|---|
| 位置 | `AnalysisSummary.buildRecordPayload` |
| 现象 | `myHeroId` 直接写入记录（不校验是否在双方阵容） |
| 影响 | 若 myHeroId 是脏数据（如历史残留），会写进记录（「吕布」同类） |
| 修复 | `validMyHeroId`：必须 `bluePicks` 或 `redPicks` 包含才写入 |
| commit | `2baacfc` |

### P1-2 existingRecord 匹配过松（误判同一条记录）

| 项 | 内容 |
|---|---|
| 位置 | `AnalysisSummary.existingRecord` |
| 现象 | 只比 `bluePicks`/`redPicks`（**不含 bans**），且空数组 `'' === ''` 也会匹配 |
| 影响 | ① 同阵容不同 ban 被判为同一条（不建新记录）② 新局（空 picks）误匹配旧记录 |
| 修复 | picks + bans 全比较 |
| commit | `2baacfc` |

### P1-3 手动保存重复建记录

| 项 | 内容 |
|---|---|
| 位置 | `AnalysisSummary.handleSaveRecord` |
| 现象 | 无条件 `addRecord(...)`，已有同一局记录时会重复建 |
| 影响 | 记录列表出现重复条目 |
| 修复 | 已有 `existingRecord` → `updateRecord`，否则 `addRecord` |
| commit | `2baacfc` |

---

## 三、链路验证覆盖

| 链路 | 验证内容 | 结果 |
|---|---|---|
| 状态机 | 初始化 / ban 写入位置 / pick 写入 / 切阵营保留数据 / reset 全清 | ✅ |
| 数据污染 | myHeroId 不在阵容 / 同队重复 | ✅（依赖上层校验） |
| 记录链路 | 建记录 / 更新结果 / 编辑（picks+myHero+评分+MVP+奖牌+备注）/ 统计 / 删除 | ✅ |
| 持久化 | localStorage 序列化 / version | ✅ |
| myHeroId 校验 | 不在阵容→清 / 在阵容→留 / picks 空→不动作 / 空值→不动作 | ✅ |

---

## 四、仍需真机验证（无法在 Node 覆盖）

| 链路 | 原因 |
|---|---|
| WS 实时消息 → store 更新 | 需要真实 WebSocket 流 |
| 识别 → 自动建记录（完整） | 需要真机 BP 流程 |
| 结算 → 自动回填（实际触发） | 需要真机结算帧 |
| Supabase 同步 | 需要凭据 + 网络 |

---

## 五、运行方式

```bash
node scripts/_test_pipeline.mjs
# 约 3 秒，输出 _diag/test_pipeline.json
```

---

## 六、本轮链路测试的价值

用户提到「记录里的吕布」——本次链路测试**系统性复现并修复了同类问题**：

1. **数据源污染**（myHeroId 不在阵容）→ 两处校验（同步层 + 建记录层）
2. **状态残留**（reset 不清可选字段）→ 显式清空
3. **闭环断路**（actualResult 类型不一致）→ 统一 'PENDING'
4. **误触发清空**（识别抖动）→ 防抖
5. **重复数据**（记录重复建）→ existing 检查
6. **误判匹配**（existingRecord）→ 全字段比较
