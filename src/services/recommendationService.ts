import type { BpState, Hero, HeroRecommendation, Side } from '@/types';
import {
  ALGORITHM_WEIGHTS,
  COMPOSITION_ROLE_WEIGHTS,
  RECOMMENDATION_TOP_K,
} from '@/data/config';
import {
  getAvailableHeroes,
  getEnemyHeroes,
  getHeroById,
  getTeamHeroes,
  calculateCompositionScore,
} from '@/services/heroService';

function calculateCompositionBonus(
  hero: Hero,
  currentTeam: Hero[],
  targetMax: number
): number {
  const currentScore = calculateCompositionScore(currentTeam);

  const projectedScore = calculateCompositionScore([...currentTeam, hero]);
  const currentSum =
    currentScore.frontline +
    currentScore.damage +
    currentScore.control +
    currentScore.sustain +
    currentScore.mobility;

  const projectedSum =
    projectedScore.frontline +
    projectedScore.damage +
    projectedScore.control +
    projectedScore.sustain +
    projectedScore.mobility;

  // Reward filling gaps: low current frontline/damage etc. gets higher bonus.
  const rawGain = projectedSum - currentSum;
  const balanceBonus =
    hero.roles.reduce((sum, role) => {
      const w = COMPOSITION_ROLE_WEIGHTS[role];
      const gapScores = {
        frontline: Math.max(0, targetMax - currentScore.frontline) * w.frontline,
        damage: Math.max(0, targetMax - currentScore.damage) * w.damage,
        control: Math.max(0, targetMax - currentScore.control) * w.control,
        sustain: Math.max(0, targetMax - currentScore.sustain) * w.sustain,
        mobility: Math.max(0, targetMax - currentScore.mobility) * w.mobility,
      };
      return (
        sum +
        gapScores.frontline +
        gapScores.damage +
        gapScores.control +
        gapScores.sustain +
        gapScores.mobility
      );
    }, 0) / 10;

  return rawGain * 0.2 + balanceBonus;
}

export function recommendHeroes(
  state: BpState,
  side: Side,
  turnType: 'PICK' | 'BAN'
): HeroRecommendation[] {
  const available = getAvailableHeroes(state);
  const teamHeroes = getTeamHeroes(state, side);
  const enemyHeroes = getEnemyHeroes(state, side);

  const scored = available.map((hero) => {
    if (turnType === 'BAN') {
      // For bans, score based on how threatening the hero is to our team composition.
      const threatToTeam = teamHeroes.reduce((sum, tm) => {
        return (
          sum +
          (hero.counters.includes(tm.id) ? 1 : 0) +
          (tm.counteredBy.includes(hero.id) ? 0.5 : 0)
        );
      }, 0);
      const metaScore = hero.aiWinRate;
      const score = metaScore + threatToTeam * 0.15;
      return {
        heroId: hero.id,
        score,
        reason:
          threatToTeam > 0
            ? `对己方阵容威胁较高，且大盘胜率 ${(hero.aiWinRate * 100).toFixed(1)}%`
            : `梯度评分 ${hero.tierScore !== undefined ? hero.tierScore.toFixed(1) : (hero.aiWinRate * 100).toFixed(1)}${hero.tier ? ' (' + hero.tier + ')' : ''}，建议禁用`,
        winRateBonus: metaScore,
        counterBonus: threatToTeam * 0.15,
        synergyBonus: 0,
        compositionBonus: 0,
        counterPenalty: 0,
      };
    }

    const winRateBonus = hero.aiWinRate;

    const synergyBonus = teamHeroes.reduce((sum, tm) => {
      const mutualSynergy =
        (hero.synergies.includes(tm.id) ? 1 : 0) +
        (tm.synergies.includes(hero.id) ? 0.5 : 0);
      return sum + mutualSynergy;
    }, 0);

    const counterBonus = enemyHeroes.reduce((sum, enemy) => {
      return sum + (hero.counters.includes(enemy.id) ? 1 : 0);
    }, 0);

    const counterPenalty = enemyHeroes.reduce((sum, enemy) => {
      return sum + (enemy.counters.includes(hero.id) ? 1 : 0);
    }, 0);

    const compositionBonus = calculateCompositionBonus(
      hero,
      teamHeroes,
      4.5
    );

    const score =
      winRateBonus * ALGORITHM_WEIGHTS.aiWinRate +
      synergyBonus * ALGORITHM_WEIGHTS.synergy +
      counterBonus * ALGORITHM_WEIGHTS.counter -
      counterPenalty * ALGORITHM_WEIGHTS.counterPenalty +
      compositionBonus * ALGORITHM_WEIGHTS.composition;

    const reasons: string[] = [];
    if (counterBonus > 0) reasons.push(`克制敌方 ${counterBonus} 位英雄`);
    if (synergyBonus > 0) reasons.push(`与己方阵容配合良好`);
    if (compositionBonus > 0.15) reasons.push(`补齐阵容短板`);
    if (reasons.length === 0) reasons.push(`${hero.tier ? hero.tier + '梯度' : '版本强度稳定'}${hero.tierScore !== undefined ? '，评分 ' + hero.tierScore.toFixed(1) : ''}`);

    return {
      heroId: hero.id,
      score,
      reason: reasons.join('，'),
      winRateBonus,
      counterBonus,
      synergyBonus,
      compositionBonus,
      counterPenalty,
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, RECOMMENDATION_TOP_K);
}

export function getRecommendationReason(
  heroId: string,
  state: BpState,
  side: Side
): string {
  const hero = getHeroById(heroId);
  if (!hero) return '';

  const teamHeroes = getTeamHeroes(state, side);
  const enemyHeroes = getEnemyHeroes(state, side);

  const countersEnemy = enemyHeroes.filter((e) => hero.counters.includes(e.id));
  const counteredByEnemy = enemyHeroes.filter((e) =>
    e.counters.includes(hero.id)
  );
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
