import type { Hero, HeroPosition } from '@/types';
import { POSITION_LABELS } from '@/types';

/** 五条分路（标准顺序）。 */
export const ALL_POSITIONS: HeroPosition[] = [
  'CLASH_LANE',   // 对抗路
  'JUNGLE',       // 打野
  'MID_LANE',     // 中路
  'FARM_LANE',    // 发育路
  'ROAM',         // 游走
];

export interface PositionGap {
  /** 我方已覆盖的分路 */
  covered: HeroPosition[];
  /** 我方缺失的分路（推荐优先补） */
  missing: HeroPosition[];
  /** 每条分路由哪些英雄覆盖（按主位置判断） */
  coverage: Record<HeroPosition, string[]>;
}

/**
 * 分析我方阵容的分路缺口（按「主位置」= positions[0] 判断）。
 *
 * 说明：一个英雄可能有多个可打位置（如马超 对抗路/打野），
 * 这里只把它算进主位置；客串位置通过 positionStrength 体现。
 */
export function analyzePositionGap(teamHeroes: Hero[]): PositionGap {
  const coverage: Record<string, string[]> = {};
  for (const p of ALL_POSITIONS) coverage[p] = [];

  for (const h of teamHeroes) {
    const primary = h.positions?.[0];
    if (primary && coverage[primary]) {
      coverage[primary].push(h.id);
    }
  }

  const covered = ALL_POSITIONS.filter((p) => coverage[p].length > 0);
  const missing = ALL_POSITIONS.filter((p) => coverage[p].length === 0);

  return {
    covered,
    missing,
    coverage: coverage as Record<HeroPosition, string[]>,
  };
}

/**
 * 英雄在指定分路的适配强度。
 *   1.0 = 主位置（positions[0]）
 *   0.7 = 客串（positions[1..]）
 *   0   = 打不了
 */
export function positionStrength(hero: Hero, position: HeroPosition): number {
  const idx = (hero.positions || []).indexOf(position);
  if (idx === 0) return 1.0;
  if (idx > 0) return 0.7;
  return 0;
}

/** 按可打位置把英雄分组（一个多位置英雄会出现在多组）。 */
export function groupHeroesByPosition(heroes: Hero[]): Record<HeroPosition, Hero[]> {
  const out: Record<string, Hero[]> = {};
  for (const p of ALL_POSITIONS) out[p] = [];
  for (const h of heroes) {
    for (const p of h.positions || []) {
      if (out[p]) out[p].push(h);
    }
  }
  return out as Record<HeroPosition, Hero[]>;
}

/** 分路中文名。 */
export function positionLabel(pos: HeroPosition): string {
  return POSITION_LABELS[pos] || pos;
}

/** 当前阵容更像「缺什么功能」（用 profession 粗判，供文案提示）。 */
export function missingRoleHint(teamHeroes: Hero[]): string | null {
  const profs = teamHeroes.map((h) => h.profession || '').filter(Boolean);
  const has = (kw: string) => profs.some((p) => p.includes(kw));

  if (teamHeroes.length === 0) return null;
  if (!has('辅') && teamHeroes.length >= 3) return '缺辅助/开团';
  if (!has('核') && teamHeroes.length >= 3) return '缺核心输出';
  if (!has('坦') && !has('前排') && teamHeroes.length >= 4) return '缺前排';
  return null;
}
