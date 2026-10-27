import type { Hero, HeroRole, CompositionScore } from '@/types';
import { COMPOSITION_ROLE_WEIGHTS } from '@/data/config';

/** 阵容五维度。 */
export type CompositionDim = keyof CompositionScore;

export const COMPOSITION_DIMS: CompositionDim[] = [
  'frontline',
  'damage',
  'control',
  'sustain',
  'mobility',
];

export const DIM_LABELS: Record<CompositionDim, string> = {
  frontline: '前排',
  damage: '输出',
  control: '控制',
  sustain: '续航',
  mobility: '机动',
};

/**
 * profession（细分定位）→ 阵容五维度贡献。
 *
 * 数据来自 heroes.json 的 profession 字段（约 30 种），
 * 一个英雄可能有多段（如「边核/野核」），按 "/" 拆分后累加。
 */
export const PROFESSION_DIMS: Record<string, Partial<Record<CompositionDim, number>>> = {
  // 打野
  野核: { damage: 1.2, control: 0.5, mobility: 1.2 },
  战野: { frontline: 0.6, damage: 1.2, control: 0.4, mobility: 1.0 },
  坦野: { frontline: 0.8, damage: 0.8, control: 0.8, sustain: 0.4, mobility: 0.8 },
  射野: { damage: 1.4, mobility: 0.8 },

  // 中路
  法核: { damage: 1.5, control: 0.8, sustain: 0.2, mobility: 0.3 },
  大法核: { damage: 1.6, control: 0.8, sustain: 0.2, mobility: 0.2 },
  工具人法师: { damage: 0.8, control: 1.0, sustain: 0.3, mobility: 0.3 },

  // 对抗路
  战边: { frontline: 0.8, damage: 1.0, control: 0.4, sustain: 0.3, mobility: 0.6 },
  坦边: { frontline: 1.5, damage: 0.3, control: 0.6, sustain: 0.5, mobility: 0.2 },
  边核: { frontline: 0.6, damage: 1.2, control: 0.4, sustain: 0.2, mobility: 0.7 },

  // 发育路
  射核: { damage: 1.8, control: 0, sustain: 0, mobility: 0.3 },
  自保射: { damage: 1.6, control: 0.2, sustain: 0, mobility: 0.5 },
  抗压射: { damage: 1.5, control: 0, sustain: 0.3, mobility: 0.2 },
  带线射: { damage: 1.4, control: 0.2, sustain: 0, mobility: 0.6 },

  // 游走
  开团辅: { frontline: 0.8, damage: 0.2, control: 1.5, sustain: 0.8, mobility: 0.4 },
  怕开团辅: { frontline: 0.3, damage: 0.3, control: 0.8, sustain: 1.5, mobility: 0.3 },
  反手辅: { frontline: 0.6, damage: 0.2, control: 1.0, sustain: 1.5, mobility: 0.3 },
  均衡辅: { frontline: 0.5, damage: 0.4, control: 1.0, sustain: 1.0, mobility: 0.3 },
};

/** 各维度的「健康目标值」（5 人阵容）。 */
export const COMPOSITION_TARGET: Record<CompositionDim, number> = {
  frontline: 2.5,
  damage: 4.0,
  control: 2.5,
  sustain: 2.0,
  mobility: 2.0,
};

function emptyScore(): CompositionScore {
  return { frontline: 0, damage: 0, control: 0, sustain: 0, mobility: 0 };
}

function addScore(target: CompositionScore, delta: Partial<Record<CompositionDim, number>>) {
  for (const dim of COMPOSITION_DIMS) {
    target[dim] += delta[dim] ?? 0;
  }
}

/**
 * 用 profession 计算阵容五维度（比 role 更细）。
 *
 * 没有 profession 的英雄回退到 role 权重（COMPOSITION_ROLE_WEIGHTS）。
 */
export function evaluateProfessionComposition(heroes: Hero[]): CompositionScore {
  const score = emptyScore();

  for (const hero of heroes) {
    const prof = (hero.profession || '').trim();
    const parts = prof
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    let matched = false;
    for (const part of parts) {
      const weights = PROFESSION_DIMS[part];
      if (weights) {
        addScore(score, weights);
        matched = true;
      }
    }

    // 回退：按 role 权重
    if (!matched) {
      for (const role of hero.roles || []) {
        const w = COMPOSITION_ROLE_WEIGHTS[role as HeroRole];
        if (w) addScore(score, w);
      }
    }
  }

  return score;
}

/**
 * 计算「候选英雄能补多少阵容缺口」。
 *
 * 返回 { value: 0~1, bestDim, bestGain }：
 *   value = 各维度（缺口 × 候选贡献）之和 / 5
 *   bestDim = 补得最多的维度（用于文案）
 */
export function compositionGain(
  hero: Hero,
  teamHeroes: Hero[]
): { value: number; bestDim: CompositionDim | null; bestGain: number } {
  const current = evaluateProfessionComposition(teamHeroes);
  const heroDims = evaluateProfessionComposition([hero]);

  let total = 0;
  let bestDim: CompositionDim | null = null;
  let bestGain = 0;

  for (const dim of COMPOSITION_DIMS) {
    const gap = Math.max(0, COMPOSITION_TARGET[dim] - current[dim]);
    const gain = gap * (heroDims[dim] || 0);
    total += gain;
    if (gain > bestGain) {
      bestGain = gain;
      bestDim = dim;
    }
  }

  return {
    value: Math.max(0, Math.min(1, total / 5)),
    bestDim,
    bestGain,
  };
}
