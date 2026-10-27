import type { HeroRole, Side, Turn } from '@/types';

export const ROLE_LABELS: Record<HeroRole, string> = {
  TANK: '坦克',
  WARRIOR: '战士',
  ASSASSIN: '刺客',
  MAGE: '法师',
  MARKSMAN: '射手',
  SUPPORT: '辅助',
};

export const ROLE_COLORS: Record<HeroRole, string> = {
  TANK: '#3b82f6',
  WARRIOR: '#ef4444',
  ASSASSIN: '#a855f7',
  MAGE: '#06b6d4',
  MARKSMAN: '#f59e0b',
  SUPPORT: '#22c55e',
};

export const SIDE_LABELS: Record<Side, string> = {
  BLUE: '蓝方',
  RED: '红方',
};

export const SIDE_COLORS: Record<Side, string> = {
  BLUE: '#1a3a8b',
  RED: '#8b1a1a',
};

// 当前版本（王者段位及以上）规则：10 盲 Ban + 10 选。
// 盲 Ban 阶段：双方各 5 个 Ban 位，互相看不到对方 Ban 什么（可能出现重复 Ban）。
// 选英雄阶段：蓝 1 -> 红 2 -> 蓝 2 -> 红 2 -> 蓝 2 -> 红 1。
export const PICK_SEQUENCE: Turn[] = [
  { index: 0, side: 'BLUE', type: 'PICK', description: '蓝方首选' },
  { index: 1, side: 'RED', type: 'PICK', description: '红方选择' },
  { index: 2, side: 'RED', type: 'PICK', description: '红方选择' },
  { index: 3, side: 'BLUE', type: 'PICK', description: '蓝方选择' },
  { index: 4, side: 'BLUE', type: 'PICK', description: '蓝方选择' },
  { index: 5, side: 'RED', type: 'PICK', description: '红方选择' },
  { index: 6, side: 'RED', type: 'PICK', description: '红方选择' },
  { index: 7, side: 'BLUE', type: 'PICK', description: '蓝方选择' },
  { index: 8, side: 'BLUE', type: 'PICK', description: '蓝方选择' },
  { index: 9, side: 'RED', type: 'PICK', description: '红方选择' },
];

/** 已废弃：保留导出仅为了兼容旧引用，新代码请使用 PICK_SEQUENCE。 */
export const TURN_SEQUENCE = PICK_SEQUENCE;

export const ALGORITHM_WEIGHTS = {
  aiWinRate: 0.35,
  synergy: 0.15,
  counter: 0.2,
  counterPenalty: 0.2,
  composition: 0.1,
};

export const COMPOSITION_ROLE_WEIGHTS: Record<
  HeroRole,
  { frontline: number; damage: number; control: number; sustain: number; mobility: number }
> = {
  TANK: { frontline: 2.5, damage: 0.3, control: 0.8, sustain: 0.5, mobility: 0.2 },
  WARRIOR: { frontline: 1.0, damage: 0.8, control: 0.5, sustain: 0.3, mobility: 0.6 },
  ASSASSIN: { frontline: 0.0, damage: 1.2, control: 0.6, sustain: 0.0, mobility: 1.5 },
  MAGE: { frontline: 0.0, damage: 1.5, control: 0.8, sustain: 0.3, mobility: 0.3 },
  MARKSMAN: { frontline: 0.0, damage: 1.8, control: 0.0, sustain: -0.3, mobility: 0.3 },
  SUPPORT: { frontline: 0.5, damage: 0.2, control: 1.0, sustain: 1.5, mobility: 0.3 },
};

export const RECOMMENDATION_TOP_K = 5;
