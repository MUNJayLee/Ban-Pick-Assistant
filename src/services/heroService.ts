import type { Hero, HeroRole, Side, CompositionScore, BpPhase } from '@/types';
import { COMPOSITION_ROLE_WEIGHTS, ROLE_LABELS } from '@/data/config';

let heroes: Hero[] = [];
let heroMap = new Map<string, Hero>();

export function setHeroesData(data: { heroes: Hero[] }) {
  heroes = data.heroes;
  heroMap = new Map<string, Hero>(heroes.map((h) => [h.id, h]));
}

export function getAllHeroes(): Hero[] {
  return heroes;
}

export function getHeroById(id: string): Hero | undefined {
  return heroMap.get(id);
}

export function getHeroesByRole(role: HeroRole): Hero[] {
  return heroes.filter((h) => h.roles.includes(role));
}

export function getRoleLabel(role: HeroRole): string {
  return ROLE_LABELS[role];
}

export function getHeroesByIds(ids: string[]): Hero[] {
  return ids.map((id) => heroMap.get(id)).filter((h): h is Hero => !!h);
}

export function getUsedHeroIds(state: {
  blueBans: string[];
  redBans: string[];
  bluePicks: string[];
  redPicks: string[];
}): Set<string> {
  return new Set([
    ...state.blueBans,
    ...state.redBans,
    ...state.bluePicks,
    ...state.redPicks,
  ]);
}

/**
 * 根据当前 BP 阶段返回“可选”的英雄 id 集合。
 *
 * 盲 Ban 阶段双方互相看不到，因此允许双方禁用相同英雄：
 * - 我方 Ban 阶段：仅排除我方已 Ban + 双方已选英雄
 * - 敌方 Ban 阶段：仅排除敌方已 Ban + 双方已选英雄
 * - 选英雄阶段：双方所有 Ban / Pick 均不可用
 */
export function getSelectableHeroIds(
  state: {
    blueBans: string[];
    redBans: string[];
    bluePicks: string[];
    redPicks: string[];
  },
  phase: BpPhase,
  userSide: Side
): Set<string> {
  if (phase === 'MY_BAN') {
    const myBans = userSide === 'BLUE' ? state.blueBans : state.redBans;
    return new Set([...myBans, ...state.bluePicks, ...state.redPicks]);
  }
  if (phase === 'ENEMY_BAN') {
    const enemyBans = userSide === 'BLUE' ? state.redBans : state.blueBans;
    return new Set([...enemyBans, ...state.bluePicks, ...state.redPicks]);
  }
  return getUsedHeroIds(state);
}

export function getAvailableHeroes(state: {
  blueBans: string[];
  redBans: string[];
  bluePicks: string[];
  redPicks: string[];
}): Hero[] {
  const used = getUsedHeroIds(state);
  return heroes.filter((h) => !used.has(h.id));
}

export function getTeamHeroes(state: {
  bluePicks: string[];
  redPicks: string[];
}, side: Side): Hero[] {
  return getHeroesByIds(side === 'BLUE' ? state.bluePicks : state.redPicks);
}

export function getEnemyHeroes(state: {
  bluePicks: string[];
  redPicks: string[];
}, side: Side): Hero[] {
  return getHeroesByIds(side === 'BLUE' ? state.redPicks : state.bluePicks);
}

export function calculateCompositionScore(teamHeroes: Hero[]): CompositionScore {
  const score: CompositionScore = {
    frontline: 0,
    damage: 0,
    control: 0,
    sustain: 0,
    mobility: 0,
  };

  teamHeroes.forEach((hero) => {
    hero.roles.forEach((role) => {
      const weights = COMPOSITION_ROLE_WEIGHTS[role];
      score.frontline += weights.frontline;
      score.damage += weights.damage;
      score.control += weights.control;
      score.sustain += weights.sustain;
      score.mobility += weights.mobility;
    });
  });

  return score;
}

export function normalizeCompositionScore(score: CompositionScore): CompositionScore {
  const max = 8;
  return {
    frontline: Math.min(score.frontline / max, 1),
    damage: Math.min(Math.max(score.damage / max, 0), 1),
    control: Math.min(score.control / max, 1),
    sustain: Math.min(Math.max(score.sustain / max, 0), 1),
    mobility: Math.min(score.mobility / max, 1),
  };
}

export function getWinRateForDisplay(winRate: number): string {
  return `${(winRate * 100).toFixed(1)}%`;
}

/**
 * 计算某方阵容的综合强度（0-100），由三个维度合成：
 * 1. 版本强度（梯度评分均值，0-100）
 * 2. 阵容维度（前排/输出/控制/续航/机动归一化均值，0-100）
 * 3. 克制关系（净克制数，以 50 为基准上下浮动）
 */
export function calculateTeamStrength(
  state: { bluePicks: string[]; redPicks: string[] },
  side: Side
): number {
  const team = getTeamHeroes(state, side);
  const enemy = getEnemyHeroes(state, side);
  if (team.length === 0) return 0;

  // 1. 版本强度（0-100）
  const version =
    team.reduce((sum, h) => sum + (h.tierScore ?? h.aiWinRate * 100), 0) / team.length;

  // 2. 阵容维度（0-100）
  const norm = normalizeCompositionScore(calculateCompositionScore(team));
  const compScore =
    ((norm.frontline + norm.damage + norm.control + norm.sustain + norm.mobility) / 5) * 100;

  // 3. 克制关系（净克制数，以 50 为基准）
  let counter = 0;
  let countered = 0;
  for (const h of team) {
    for (const e of enemy) {
      if (h.counters.includes(e.id)) counter += 1;
      if (e.counters.includes(h.id)) countered += 1;
    }
  }
  const counterScore = 50 + (counter - countered) * 3;

  return version * 0.6 + compScore * 0.25 + counterScore * 0.15;
}

/**
 * 根据双方阵容综合评分，用 logistic 曲线换算蓝方胜率（0-1）。
 * 评分差 0 → 50%，差 10 分 → 约 73%，差 20 分 → 约 88%。
 */
export function calculateWinProbability(bluePower: number, redPower: number): number {
  const diff = bluePower - redPower;
  return 1 / (1 + Math.exp(-diff / 10));
}
