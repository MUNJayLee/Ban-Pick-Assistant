import type { Hero, HeroPosition } from '@/types';
import { POSITION_LABELS } from '@/types';
import { COMPOSITION_ROLE_WEIGHTS } from '@/data/config';
import { calculateCompositionScore } from '@/services/heroService';
import { positionStrength, type PositionGap } from './position';

/** 单个推荐因子的结果：value 为 0-1 的归一化分量。 */
export interface FactorResult {
  value: number;
  reason?: string;
}

const ALL_POSITIONS: HeroPosition[] = [
  'CLASH_LANE',
  'MID_LANE',
  'FARM_LANE',
  'JUNGLE',
  'ROAM',
];

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * 版本强度：优先用天元之弈梯度评分（0-100），回退到 aiWinRate 的映射值。
 * 注意：aiWinRate 当前是 tierScore 的线性映射（0.42-0.58），并非真实胜率。
 */
export function versionStrength(hero: Hero): FactorResult {
  const raw = hero.tierScore !== undefined ? hero.tierScore : hero.aiWinRate * 100;
  return {
    value: clamp01(raw / 100),
    reason: hero.tier ? `${hero.tier} 梯度` : undefined,
  };
}

/**
 * 克制敌方（三层数据，按可靠性递减）。
 *
 *   ① counterDetails.advantageIndex —— 全局克制指数（不分位置，打野也适用）
 *   ② laneMatchups.winRate         —— 对线胜率（只适合同路对线）
 *   ③ counters 列表                —— 兜底
 *
 * 所有层级都要求 totalMatches >= MIN_MATCHES，避免「1 场 100% 胜率」污染。
 */
const MIN_MATCHES = 100;

export function counterScore(hero: Hero, enemyHeroes: Hero[]): FactorResult {
  let score = 0;
  const hits: string[] = [];

  for (const e of enemyHeroes) {
    const ew = 1 + (e.tierScore ?? 50) / 100; // 1.0 ~ 2.0（敌核更重）

    // ① counterDetails（advantageIndex，全局克制）
    const cd = hero.counterDetails?.find((x) => x.heroName === e.name);
    if (cd && cd.totalMatches >= MIN_MATCHES) {
      const edge = Math.max(0, Math.min(1, cd.advantageIndex / 6));
      if (edge > 0.15) {
        score += edge * ew;
        hits.push(e.name);
      }
      continue;
    }

    // ② laneMatchups（对线胜率）
    const lm = hero.laneMatchups?.find((x) => x.heroName === e.name);
    if (lm && lm.totalMatches >= MIN_MATCHES) {
      const edge = (lm.winRate - 0.5) * 2;
      if (edge > 0.02) {
        score += edge * ew;
        hits.push(e.name);
      }
      continue;
    }

    // ③ 兜底：克制列表
    if (hero.counters?.includes(e.id)) {
      score += 0.5 * ew;
      hits.push(e.name);
    }
  }

  return {
    value: clamp01(score / 2.5),
    reason: hits.length ? `克制 ${hits.slice(0, 2).join('、')}` : undefined,
  };
}

/**
 * 被克制（负向因子）。
 *
 * 用「敌方英雄的 counterDetails 里是否把我方候选列为克制对象」，
 * 以及我方候选的 counteredByDetails。
 */
export function counterPenalty(hero: Hero, enemyHeroes: Hero[]): FactorResult {
  let score = 0;
  const hits: string[] = [];

  for (const e of enemyHeroes) {
    const ew = 1 + (e.tierScore ?? 50) / 100;

    // ① 敌方 counterDetails 里克制该英雄
    const cd = e.counterDetails?.find((x) => x.heroName === hero.name);
    if (cd && cd.totalMatches >= MIN_MATCHES) {
      const edge = Math.max(0, Math.min(1, cd.advantageIndex / 6));
      if (edge > 0.15) {
        score += edge * ew;
        hits.push(e.name);
      }
      continue;
    }

    // ② 该英雄的 counteredByDetails 里被敌方克制
    const cb = hero.counteredByDetails?.find((x) => x.heroName === e.name);
    if (cb && cb.totalMatches >= MIN_MATCHES) {
      const edge = Math.max(0, Math.min(1, -cb.advantageIndex / 6));
      if (edge > 0.15) {
        score += edge * ew;
        hits.push(e.name);
      }
      continue;
    }

    // ③ 兜底
    if (e.counters?.includes(hero.id)) {
      score += 0.5 * ew;
      hits.push(e.name);
    }
  }

  return {
    value: clamp01(score / 2.5),
    reason: hits.length ? `被 ${hits.slice(0, 2).join('、')} 克制` : undefined,
  };
}

/** 搭配：与己方已选英雄存在 synergy 的程度（双向）。 */
export function synergyScore(hero: Hero, teamHeroes: Hero[]): FactorResult {
  let score = 0;
  for (const t of teamHeroes) {
    if (hero.synergies.includes(t.id)) score += 1;
    if (t.synergies.includes(hero.id)) score += 0.5;
  }
  return {
    value: clamp01(score / 2),
    reason: score > 0 ? '与己方阵容配合良好' : undefined,
  };
}

/** 较差搭档：与己方已选英雄存在 badSynergy 的程度（负向因子）。 */
export function antiSynergyPenalty(hero: Hero, teamHeroes: Hero[]): FactorResult {
  const bad = hero.antiSynergies || [];
  let count = 0;
  for (const t of teamHeroes) {
    if (bad.includes(t.id)) count += 1;
  }
  return {
    value: clamp01(count / 2),
    reason: count > 0 ? `与己方 ${count} 位英雄配合较差` : undefined,
  };
}

/**
 * 位置适配（分路驱动）：
 *   - 优先补「我方缺失分路」
 *   - 主位置强度 1.0 / 客串 0.7
 *   - 非缺位位置只保留 30% 价值（缺位优先 + 其他也展示）
 */
export function positionFit(
  hero: Hero,
  teamHeroes: Hero[],
  gap?: PositionGap,
): FactorResult {
  const positions = hero.positions || [];
  if (positions.length === 0) return { value: 0 };

  // 没有 gap 信息时退回旧逻辑（按覆盖数）
  if (!gap) {
    const covered = new Set<HeroPosition>();
    teamHeroes.forEach((t) => t.positions?.forEach((p) => covered.add(p)));
    const newPositions = positions.filter((p) => !covered.has(p));
    return {
      value: clamp01(newPositions.length * 0.7),
      reason:
        newPositions.length > 0
          ? `补${newPositions.map((p) => POSITION_LABELS[p]).join('、')}`
          : undefined,
    };
  }

  let best = 0;
  let bestPos: HeroPosition | null = null;
  for (const pos of positions) {
    const strength = positionStrength(hero, pos);
    const isMissing = gap.missing.includes(pos);
    const value = isMissing ? strength : strength * 0.3;
    if (value > best) {
      best = value;
      bestPos = pos;
    }
  }

  const isMissingBest = bestPos ? gap.missing.includes(bestPos) : false;
  return {
    value: clamp01(best),
    reason: bestPos
      ? `补${POSITION_LABELS[bestPos]}${isMissingBest ? '（缺位）' : ''}`
      : undefined,
  };
}

export function pickPressure(hero: Hero): FactorResult {
  const pr = hero.pickRate ?? 0;
  const br = hero.banRate ?? 0;
  return {
    value: clamp01((pr + br) / 0.4),
    reason: br > 0.15 ? '高禁用率，宜优先抢' : undefined,
  };
}

/** 阵容缺口：按角色权重衡量候选英雄对阵容短板（前排/控制/续航等）的补齐程度。 */
export function compositionGap(hero: Hero, teamHeroes: Hero[]): FactorResult {
  const current = calculateCompositionScore(teamHeroes);
  // 各维度的“舒适目标值”，接近该值时不再补位加分。
  const target = {
    frontline: 4,
    damage: 4,
    control: 3,
    sustain: 2.5,
    mobility: 2,
  };

  let gap = 0;
  for (const role of hero.roles) {
    const w = COMPOSITION_ROLE_WEIGHTS[role];
    gap +=
      Math.max(0, target.frontline - current.frontline) * w.frontline +
      Math.max(0, target.damage - current.damage) * w.damage +
      Math.max(0, target.control - current.control) * w.control +
      Math.max(0, target.sustain - current.sustain) * w.sustain +
      Math.max(0, target.mobility - current.mobility) * w.mobility;
  }

  const value = clamp01(gap / 20);
  return { value, reason: value > 0.5 ? '补齐阵容短板' : undefined };
}

/** 对我方阵容的威胁（用于 Ban）：候选英雄克制我方 + 我方被其克制。 */
export function threatToTeam(hero: Hero, teamHeroes: Hero[]): FactorResult {
  let threat = 0;
  for (const t of teamHeroes) {
    if (hero.counters.includes(t.id)) threat += 1;
    if (t.counteredBy.includes(hero.id)) threat += 0.5;
  }
  return {
    value: clamp01(threat / 2),
    reason: threat > 0 ? '威胁我方阵容' : undefined,
  };
}
