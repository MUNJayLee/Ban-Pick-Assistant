import type { Hero, HeroPosition } from '@/types';
import { POSITION_LABELS } from '@/types';
import { COMPOSITION_ROLE_WEIGHTS } from '@/data/config';
import { calculateCompositionScore } from '@/services/heroService';

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

/** 克制敌方：候选英雄克制敌方已选英雄的数量。 */
export function counterScore(hero: Hero, enemyHeroes: Hero[]): FactorResult {
  const count = enemyHeroes.filter((e) => hero.counters.includes(e.id)).length;
  return {
    value: clamp01(count / 2),
    reason: count > 0 ? `克制敌方 ${count} 位` : undefined,
  };
}

/** 被克制：候选英雄被敌方已选英雄克制的数量（负向因子）。 */
export function counterPenalty(hero: Hero, enemyHeroes: Hero[]): FactorResult {
  const count = enemyHeroes.filter((e) => e.counters.includes(hero.id)).length;
  return {
    value: clamp01(count / 2),
    reason: count > 0 ? `被敌方 ${count} 位克制` : undefined,
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

/** 位置适配：候选英雄能填补多少个尚未被己方覆盖的分路。 */
export function positionFit(hero: Hero, teamHeroes: Hero[]): FactorResult {
  const positions = hero.positions || [];
  if (positions.length === 0) return { value: 0 };

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

/** 抢位压力：登场率 + 禁用率越高，越应优先抢。 */
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
