# 推荐算法模块设计 v2

> 目标：建立一套**分路驱动 + 敌我 counter + 阵容结构**的推荐流程，替代当前的简单加权。
> 状态：规划稿（待确认后实施）

---

## 一、现状盘点

### 1.1 数据基础（很完整）

`src/data/heroes.json` 共 133 英雄，每个英雄都有：

| 字段 | 示例 | 用途 |
|---|---|---|
| `positions` | `["MID_LANE"]` | 分路匹配（JUNGLE 37 / CLASH 34 / MID 32 / ROAM 32 / FARM 23，24 个多位置） |
| `roles` | `["MAGE"]` | 职业（刺客44/战士43/辅助34/法师28/坦克28/射手24） |
| **`profession`** | `"野核"` / `"法核"` / `"开团辅"` | **功能定位**（约 30 种，如野核15、法核14、战边11、开团辅10、怕开团辅9、工具人法师7、反手辅6） |
| `tierScore` / `tier` | `100` / `"T0"` | 版本强度（T0 10个 / T0.5 7 / T1 31 / T2 44 / T3 30 / T4 11） |
| `counters` | `["jinchan",...]` | 克制的英雄（每人 4 个） |
| `counteredBy` | `["aguduo",...]` | 被谁克制（每人 4 个） |
| `synergies` | `["chengyaojin",...]` | 协同英雄（每人 4 个） |
| `antiSynergies` | `["lvbu",...]` | 冲突英雄（每人 4 个） |
| `pickRate` / `banRate` | `0.0659` / `0.1474` | 抢位压力 |
| `heroPower` | `17994.2` | 英雄战力（高分段参考） |

### 1.2 现有算法（7 因子加权）

`src/services/recommendation/` 已有：
- `factors.ts`：9 个因子函数（版本/克制/被克/协同/冲突/位置/抢位/阵容缺口/威胁）
- `strategy.ts`：`scorePick`（7 因子加权求和）、`scoreBan`（3 因子）
- `weights.ts`：权重配置

**当前 pick 权重**：
```
version 0.25 / counter 0.18 / synergy 0.10 / antiSynergy 0.08
position 0.25 / pressure 0.07 / gap 0.15 / penalty 0.20
```

### 1.3 现有问题

| 问题 | 表现 |
|---|---|
| **位置逻辑粗糙** | `positionFit` 只算「补几个未覆盖位置」，不区分「主玩该位置 vs 客串」。我方缺打野时，推荐里可能混入法师 |
| **克制简单计数** | `count/2` 归一化，认为「克制 1 个 T4」和「克制 1 个 T0」等价 |
| **无 BP 阶段策略** | 一楼上/五楼后手用同一套打分，没有「先手拿什么/后手 counter 什么」 |
| **阵容评估弱** | `compositionGap` 用 role 权重，没有用上 `profession`（野核/法核/开团辅）；没有「我方阵容 vs 敌方阵容」的克制矩阵 |
| **无输出分组** | 只给全局 Top N，玩家还得自己判断「该补哪个位置」 |

---

## 二、设计目标

```
① 分路驱动  —— 先算「缺哪个位置」，再在该位置的英雄池里选
② 敌我 counter —— 克制打分带权重（敌方核心权重高），并区分「我方被克」
③ BP 阶段感知 —— 先手/中段/后手策略不同
④ 阵容结构  —— 用 profession 分析前排/输出/控制/辅助结构
⑤ 分组输出  —— 按位置给推荐，带理由
```

---

## 三、新架构（6 阶段流程）

```
输入: BpState { 双方 picks/bans, userSide, pickTurnIndex, phase }
  │
  ▼
┌─────────────────────────────────────────────┐
│ 阶段 1: 上下文解析                            │
│  · 我方/敌方已选（Hero[]）                    │
│  · 当前轮次 isFirstPick / isLastPick         │
│  · 已 ban 集合                                │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ 阶段 2: 分路缺口分析                          │
│  · 5 条分路覆盖情况                           │
│  · 缺失分路 = 候选位置池                      │
│  · 缺口优先级（已选 0 个 → 全部位置都缺）      │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ 阶段 3: 候选池构建                            │
│  · 每个缺口分路 → 该分路的英雄（positions）    │
│  · 过滤已 ban/pick                            │
│  · 排除「客串分路」（除非主位置已覆盖）        │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ 阶段 4: 多因子打分（每个候选）                │
│  · 版本强度 tierScore                        │
│  · 克制敌方（加权：克制核心 > 克制辅助）      │
│  · 被克制（负向）                             │
│  · 协同我方 / 冲突我方（负向）                 │
│  · 分路强度（主位置 vs 客串）                 │
│  · 抢位压力                                   │
│  · 阵容结构缺口（用 profession）              │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ 阶段 5: BP 策略调整                          │
│  · 先手（1-2楼）: 偏好「难被克制 + 多面手」    │
│  · 中段（3楼）  : 常规补位                    │
│  · 后手（4-5楼）: 偏好「counter 敌方核心」     │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│ 阶段 6: 阵容级评估（可选，用于整体建议）      │
│  · 我方阵容结构（前排/输出/控制/续航/机动）    │
│  · 敌我克制矩阵（net counter）                │
│  · 胜率预估                                   │
└──────────────────┬──────────────────────────┘
                   ▼
输出: 按分路分组的 Top3 + 具体理由 + 阵容建议
```

---

## 四、核心算法细节

### 4.1 分路缺口分析

```typescript
type HeroPosition = 'CLASH_LANE' | 'MID_LANE' | 'FARM_LANE' | 'JUNGLE' | 'ROAM';

interface PositionGap {
  covered: HeroPosition[];   // 我方已覆盖
  missing: HeroPosition[];   // 缺失（推荐目标）
  // 多位置英雄可以补多个位置，但一个英雄只算一条分路
}

function analyzePositionGap(teamHeroes: Hero[]): PositionGap {
  const covered = new Set<HeroPosition>();
  for (const h of teamHeroes) {
    // 一个英雄可能有多位置，取「主位置」（positions[0]）
    const primary = h.positions?.[0];
    if (primary) covered.add(primary);
  }
  const missing = ALL_POSITIONS.filter(p => !covered.has(p));
  return { covered: [...covered], missing };
}
```

**关键改进**：主位置 vs 客串
```typescript
function positionStrength(hero: Hero, position: HeroPosition): number {
  const idx = (hero.positions || []).indexOf(position);
  if (idx === 0) return 1.0;      // 主位置
  if (idx > 0) return 0.7;        // 客串
  return 0;                        // 不会该位置
}
```

### 4.2 克制打分（加权版）

当前：`克制数 / 2`

改进：
```typescript
function counterScore(hero: Hero, enemyHeroes: Hero[]): number {
  let score = 0;
  for (const e of enemyHeroes) {
    if (hero.counters.includes(e.id)) {
      // 克制核心（tierScore 高）权重更大
      score += 0.5 + 0.5 * (e.tierScore ?? 50) / 100;
    }
  }
  // 归一化：最多克制 3 个核心英雄
  return clamp01(score / 2.5);
}

function counterPenalty(hero: Hero, enemyHeroes: Hero[]): number {
  let score = 0;
  for (const e of enemyHeroes) {
    if (e.counters.includes(hero.id)) {
      score += 0.5 + 0.5 * (e.tierScore ?? 50) / 100;
    }
  }
  return clamp01(score / 2.5);
}
```

### 4.3 阵容结构（用 profession）

`profession` 字段（野核/法核/战边/开团辅/反手辅/工具人法师...）可以映射到阵容维度：

```typescript
type CompositionDimension = 'frontline' | 'damage' | 'control' | 'sustain' | 'mobility';

// profession → 维度贡献
const PROFESSION_WEIGHTS: Record<string, CompositionDimension[]> = {
  '野核': ['damage', 'mobility'],
  '法核': ['damage', 'control'],
  '大法核': ['damage', 'control'],
  '工具人法师': ['control'],
  '战边': ['frontline', 'damage'],
  '坦边': ['frontline'],
  '抗压射': ['damage'],
  '射核': ['damage'],
  '自保射': ['damage'],
  '开团辅': ['control', 'frontline'],
  '怕开团辅': ['sustain'],
  '反手辅': ['sustain', 'control'],
  '均衡辅': ['sustain', 'control'],
  // ... 按实际数据补齐
};
```

**阵容评分**：
```typescript
function evaluateComposition(teamHeroes: Hero[]): Record<CompositionDimension, number> {
  const dims = { frontline: 0, damage: 0, control: 0, sustain: 0, mobility: 0 };
  for (const h of teamHeroes) {
    const prof = h.profession || '';
    const parts = prof.split('/').map(s => s.trim());
    for (const part of parts) {
      for (const dim of (PROFESSION_WEIGHTS[part] || [])) dims[dim] += 1;
    }
  }
  return dims;
}
```

### 4.4 BP 阶段策略

```typescript
function strategyMultiplier(
  hero: Hero, state: BpState, side: Side, enemyHeroes: Hero[]
): number {
  const turn = state.pickTurnIndex;  // 0-9（全局轮次）
  const isMyFirstPick = /* 我方第一次选 */;

  // 先手（我方 1-2 楼）：拿「难被克制」的万金油
  if (isMyFirstPick) {
    const robustness = 1 - (hero.counteredBy?.length ?? 0) / 4;
    return 0.85 + robustness * 0.30;  // 0.85 ~ 1.15
  }

  // 后手（我方 4-5 楼）：counter 敌方核心
  const counterPower = counterScore(hero, enemyHeroes);
  if (isLastPick) {
    return 0.85 + counterPower * 0.40;
  }

  // 中段：常规
  return 1.0;
}
```

### 4.5 敌我克制矩阵（阵容级）

```typescript
interface CounterMatrix {
  weCounter: number;      // 我们克制敌方多少（加权）
  theyCounter: number;    // 敌方克制我们多少（加权）
  net: number;            // 净值
}

function buildCounterMatrix(team: Hero[], enemy: Hero[]): CounterMatrix {
  let weCounter = 0, theyCounter = 0;
  for (const t of team) {
    for (const e of enemy) {
      if (t.counters.includes(e.id)) weCounter += 1;
      if (e.counters.includes(t.id)) theyCounter += 1;
    }
  }
  return { weCounter, theyCounter, net: weCounter - theyCounter };
}
```

---

## 五、权重配置（建议）

```typescript
export const PICK_WEIGHTS = {
  version: 0.20,          // 版本强度
  counter: 0.20,          // 克制敌方（加权）
  penalty: 0.18,          // 被克制（负向）
  synergy: 0.10,          // 协同我方
  antiSynergy: 0.06,      // 冲突我方（负向）
  positionStrength: 0.12, // 分路强度（主位置/客串）
  pressure: 0.04,         // 抢位压力
  compositionGap: 0.10,   // 阵容结构缺口
};
```

**BAN 权重**：
```typescript
export const BAN_WEIGHTS = {
  version: 0.35,          // 版本强势
  threat: 0.40,           // 威胁我方（克制我方阵容）
  contested: 0.25,        // 对方大概率抢
};
```

---

## 六、输出设计

### 6.1 按分路分组

```typescript
interface GroupedRecommendation {
  position: HeroPosition;
  positionLabel: string;        // "打野"
  isMissing: boolean;           // 我方是否缺这个位置
  heroes: HeroRecommendation[]; // Top 3
}

// 返回
{
  gap: { missing: ['JUNGLE'], covered: ['MID_LANE', ...] },
  groups: [
    { position: 'JUNGLE', positionLabel: '打野', isMissing: true, heroes: [...] },
    { position: 'CLASH_LANE', positionLabel: '对抗路', isMissing: false, heroes: [...] },
    ...
  ],
  composition: { frontline: 2, damage: 4, control: 3, sustain: 1, mobility: 2 },
  counterMatrix: { weCounter: 3, theyCounter: 1, net: 2 },
  suggestion: '缺打野，优先补带节奏的野核（澜/镜/裴擒虎）',
}
```

### 6.2 理由要具体

```typescript
// 当前: "克制敌方 1 位，补打野，版本强度稳定"
// 改进: "克制敌方露娜（T0），与己方张飞配合良好，补打野位"
```

---

## 七、实施路线

| 步骤 | 内容 | 产出 |
|---|---|---|
| **1. 分路缺口** | `analyzePositionGap` + `positionStrength` | 先算出「缺哪个位置」 |
| **2. 分组输出** | 按分路分组推荐 | UI 显示「缺打野 → 推荐...」 |
| **3. 克制加权** | `counterScore` 加权敌核 | 克制打分更准 |
| **4. 阵容结构** | `PROFESSION_WEIGHTS` 映射 | 用上 profession 数据 |
| **5. BP 策略** | `strategyMultiplier` | 先手/后手不同 |
| **6. 克制矩阵** | `buildCounterMatrix` | 阵容级评估 |
| **7. UI 改造** | 推荐面板按分路分组 | 体验提升 |

---

## 八、验证方法

### 8.1 离线回放
- 用 `training_data/` 的 6 批次真实 BP（有金标准答案）
- 跑推荐 → 看推荐英雄是否在实际选人中
- 指标：Top1 命中率 / Top3 命中率

### 8.2 对比实验
- A/B：旧算法 vs 新算法（同一批 BP 数据）
- 看哪个更贴合实际选人

### 8.3 人工验证
- 你实际打一局，看推荐是否合理
- 重点看「缺位推荐」是否准

---

## 九、待你确认

1. **分路优先级**：推荐时是否严格「只推缺失分路」？
   - 严格：缺打野就只推打野英雄
   - 宽松：缺打野优先，但也展示其他高分英雄
2. **位置强度数据**：目前只有 `positions[0]` 主位置，客串位置强度是假设（0.7）。
   - 是否需要我采集「某英雄打某位置的胜率」？（外面数据源可能没有）
3. **输出分组**：UI 是否要改成「按分路分组」？
4. **实施优先级**：先做哪几步？（建议 1+2 先落地，立刻能看到效果）
