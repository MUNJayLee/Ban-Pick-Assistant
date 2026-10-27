import type { BpState, Hero, HeroRecommendation, Side } from '@/types';
import {
  getAvailableHeroes,
  getTeamHeroes,
  getEnemyHeroes,
  getHeroById,
} from '@/services/heroService';
import { RECOMMENDATION_TOP_K } from '@/data/config';
import { PICK_WEIGHTS, BAN_WEIGHTS } from './weights';
import {
  versionStrength,
  counterScore,
  counterPenalty,
  synergyScore,
  antiSynergyPenalty,
  positionFit,
  pickPressure,
  compositionGap,
  threatToTeam,
} from './factors';

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Pick 阶段：综合 7 个因子给出 0-100 的推荐分。 */
function scorePick(hero: Hero, teamHeroes: Hero[], enemyHeroes: Hero[]): HeroRecommendation {
  const f = {
    version: versionStrength(hero),
    counter: counterScore(hero, enemyHeroes),
    synergy: synergyScore(hero, teamHeroes),
    antiSynergy: antiSynergyPenalty(hero, teamHeroes),
    position: positionFit(hero, teamHeroes),
    pressure: pickPressure(hero),
    gap: compositionGap(hero, teamHeroes),
    penalty: counterPenalty(hero, enemyHeroes),
  };

  const raw =
    f.version.value * PICK_WEIGHTS.version +
    f.counter.value * PICK_WEIGHTS.counter +
    f.synergy.value * PICK_WEIGHTS.synergy +
    f.position.value * PICK_WEIGHTS.position +
    f.pressure.value * PICK_WEIGHTS.pressure +
    f.gap.value * PICK_WEIGHTS.gap -
    f.penalty.value * PICK_WEIGHTS.penalty -
    f.antiSynergy.value * PICK_WEIGHTS.antiSynergy;

  const reasons: string[] = [];
  if (f.counter.reason) reasons.push(f.counter.reason);
  if (f.position.reason) reasons.push(f.position.reason);
  if (f.gap.reason) reasons.push(f.gap.reason);
  if (f.synergy.reason) reasons.push(f.synergy.reason);
  if (f.pressure.reason) reasons.push(f.pressure.reason);
  if (f.penalty.reason) reasons.push(f.penalty.reason);
  if (f.antiSynergy.reason) reasons.push(f.antiSynergy.reason);
  if (f.version.reason) reasons.push(f.version.reason);
  if (reasons.length === 0) reasons.push('版本强度稳定');

  return {
    heroId: hero.id,
    score: clamp01(raw) * 100,
    reason: reasons.slice(0, 3).join('，'),
    winRateBonus: f.version.value,
    counterBonus: f.counter.value,
    synergyBonus: f.synergy.value,
    compositionBonus: f.gap.value,
    counterPenalty: f.penalty.value,
    breakdown: {
      version: f.version.value,
      counter: f.counter.value,
      synergy: f.synergy.value,
      antiSynergy: f.antiSynergy.value,
      position: f.position.value,
      pressure: f.pressure.value,
      gap: f.gap.value,
      penalty: f.penalty.value,
    },
  };
}

/** Ban 阶段：版本强度 + 对我方威胁 + 对方抢位概率。 */
function scoreBan(hero: Hero, teamHeroes: Hero[], enemyHeroes: Hero[]): HeroRecommendation {
  const version = versionStrength(hero).value;
  const threat = threatToTeam(hero, teamHeroes).value;
  const contested = pickPressure(hero).value;

  const raw =
    version * BAN_WEIGHTS.version +
    threat * BAN_WEIGHTS.threat +
    contested * BAN_WEIGHTS.contested;

  const reasons: string[] = [];
  if (threat > 0) reasons.push('威胁我方阵容');
  if (contested > 0.4) reasons.push('对方大概率会抢');
  if (hero.tier) reasons.push(`${hero.tier} 梯度`);
  if (reasons.length === 0) reasons.push('版本强势');

  return {
    heroId: hero.id,
    score: clamp01(raw) * 100,
    reason: `${reasons.join('，')}，建议禁用`,
    winRateBonus: version,
    counterBonus: threat,
    synergyBonus: 0,
    compositionBonus: 0,
    counterPenalty: 0,
  };
}

/**
 * 推荐入口：保持与原 recommendationService.recommendHeroes 相同的签名，
 * 便于既有调用方无感升级。
 */
export function recommendHeroes(
  state: BpState,
  side: Side,
  turnType: 'PICK' | 'BAN'
): HeroRecommendation[] {
  const available = getAvailableHeroes(state);
  const teamHeroes = getTeamHeroes(state, side);
  const enemyHeroes = getEnemyHeroes(state, side);

  const scored = available.map((hero) =>
    turnType === 'BAN'
      ? scoreBan(hero, teamHeroes, enemyHeroes)
      : scorePick(hero, teamHeroes, enemyHeroes)
  );

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, RECOMMENDATION_TOP_K)
    .map((rec, index) => ({ ...rec, rank: index + 1 }));
}

/** 生成某个英雄针对当前局面的详细推荐理由（英雄详情/悬浮用）。 */
export function getRecommendationReason(heroId: string, state: BpState, side: Side): string {
  const hero = getHeroById(heroId);
  if (!hero) return '';

  const teamHeroes = getTeamHeroes(state, side);
  const enemyHeroes = getEnemyHeroes(state, side);

  const countersEnemy = enemyHeroes.filter((e) => hero.counters.includes(e.id));
  const counteredByEnemy = enemyHeroes.filter((e) => e.counters.includes(hero.id));
  const synergies = teamHeroes.filter(
    (t) => hero.synergies.includes(t.id) || t.synergies.includes(hero.id)
  );

  const parts: string[] = [];
  if (countersEnemy.length) {
    parts.push(`克制 ${countersEnemy.map((h) => h.name).join('、')}`);
  }
  if (counteredByEnemy.length) {
    parts.push(`被 ${counteredByEnemy.map((h) => h.name).join('、')} 克制`);
  }
  if (synergies.length) {
    parts.push(`搭配 ${synergies.map((h) => h.name).join('、')}`);
  }
  if (!parts.length) {
    parts.push('适配当前阵容，版本强度稳定');
  }
  return parts.join('；');
}
