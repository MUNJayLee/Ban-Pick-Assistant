export type HeroRole =
  | 'TANK'
  | 'WARRIOR'
  | 'ASSASSIN'
  | 'MAGE'
  | 'MARKSMAN'
  | 'SUPPORT';

/** 英雄位置（对局中的分路） */
export type HeroPosition =
  | 'CLASH_LANE'    // 对抗路
  | 'MID_LANE'      // 中路
  | 'FARM_LANE'     // 发育路
  | 'JUNGLE'        // 打野
  | 'ROAM';         // 游走

/** 位置中文映射 */
export const POSITION_LABELS: Record<HeroPosition, string> = {
  CLASH_LANE: '对抗路',
  MID_LANE: '中路',
  FARM_LANE: '发育路',
  JUNGLE: '打野',
  ROAM: '游走',
};

export interface Hero {
  id: string;
  name: string;
  title: string;
  /** 职业分类（坦克/战士/刺客/法师/射手/辅助） */
  roles: HeroRole[];
  /** 可打位置（对抗路/中路/发育路/打野/游走） */
  positions?: HeroPosition[];
  /** 位置标签（中文，如 "对抗路/打野"） */
  positionLabel?: string;
  /** 细分定位（如 "法核"、"战边"、"开团辅"） */
  profession?: string;
  aiWinRate: number;
  popularity: number;
  difficulty: number;
  counters: string[];
  counteredBy: string[];
  synergies: string[];
  /** 较差搭档（搭配负加成，来自天元之弈 badSynergies） */
  antiSynergies?: string[];
  avatar?: string;
  /** 实时登场率（0-1 小数） */
  pickRate?: number;
  /** 实时禁用率（0-1 小数） */
  banRate?: number;
  /** 天元之弈梯度评级 (T0, T0.5, T1, T2, T3, T4) */
  tier?: string;
  /** 天元之弈梯度评分 (0-100) */
  tierScore?: number;
  /** 天元之弈分路标签 (如 "对抗路/打野") — 已迁移为 positionLabel */
  roleLabel?: string;
  /** 天元之弈战力值 */
  heroPower?: number;
  /** 是否高ban率英雄 */
  highBan?: boolean;
  /** 梯度排名 */
  tierRank?: number;
  /** 对线胜率（来自天元之弈 laneMatchups，含 winRate/advantageIndex） */
  laneMatchups?: Array<{
    heroName: string;
    winRate: number;
    advantageIndex: number;
    totalMatches: number;
  }>;
  /** 克制详情（带优势指数，比 counters 更精细） */
  counterDetails?: Array<{
    heroName: string;
    advantageIndex: number;
    totalMatches: number;
  }>;
  /** 被克制详情（带优势指数） */
  counteredByDetails?: Array<{
    heroName: string;
    advantageIndex: number;
    totalMatches: number;
  }>;
}

export type Side = 'BLUE' | 'RED';

export type BpPhase = 'MY_BAN' | 'ENEMY_BAN' | 'PICK' | 'FINISHED';

export interface BpState {
  userSide: Side;
  blueBans: string[];
  redBans: string[];
  bluePicks: string[];
  redPicks: string[];
  /** 当前所处 BP 阶段 */
  phase: BpPhase;
  /** 选英雄阶段当前轮次（0-9） */
  pickTurnIndex: number;
  /** 标记为"我"的英雄（用于记录个人对局数据） */
  myHeroId?: string;
}

export type TurnType = 'BAN' | 'PICK';

export interface Turn {
  index: number;
  side: Side;
  type: TurnType;
  description: string;
  /** 是否为盲 Ban（双方互相看不到） */
  isBlindBan?: boolean;
}

/** 推荐分数的因子分解（用于可解释性展示，各分量均为 0-1） */
export interface RecommendationBreakdown {
  /** 版本强度（梯度评分） */
  version: number;
  /** 克制敌方 */
  counter: number;
  /** 与己方搭配 */
  synergy: number;
  /** 较差搭档（负向） */
  antiSynergy: number;
  /** 位置适配（补位） */
  position: number;
  /** 热度/被抢压力 */
  pressure: number;
  /** 阵容缺口 */
  gap: number;
  /** 被敌方克制（负向） */
  penalty: number;
}

export interface HeroRecommendation {
  heroId: string;
  /** 综合推荐分（0-100） */
  score: number;
  reason: string;
  /** 兼容旧字段：版本强度分量（0-1） */
  winRateBonus: number;
  /** 兼容旧字段：克制分量（0-1） */
  counterBonus: number;
  /** 兼容旧字段：搭配分量（0-1） */
  synergyBonus: number;
  /** 兼容旧字段：阵容缺口分量（0-1） */
  compositionBonus: number;
  /** 兼容旧字段：被克制惩罚分量（0-1） */
  counterPenalty: number;
  /** 在推荐列表中的排名（从 1 开始） */
  rank?: number;
  /** 因子分解明细（可解释推荐） */
  breakdown?: RecommendationBreakdown;
}

export interface CompositionScore {
  frontline: number;
  damage: number;
  control: number;
  sustain: number;
  mobility: number;
}

export type BpRecordResult = 'CORRECT' | 'INCORRECT' | 'PENDING';
export type ActualResult = 'WIN' | 'LOSE' | 'PENDING';

export interface BpRecord {
  id: string;
  timestamp: number;
  bluePicks: string[];
  redPicks: string[];
  blueBans: string[];
  redBans: string[];
  bluePower: number;
  redPower: number;
  favored: 'BLUE' | 'RED' | 'EVEN';
  result: BpRecordResult;
  /** 我使用的英雄 */
  myHeroId?: string;
  /** 我所在的阵营 */
  mySide?: Side;
  /** 我玩的位置（从英雄 roles 自动推断） */
  myRole?: HeroRole;
  /** 我这场实际输赢 */
  actualResult?: ActualResult;
  /** 对局评分（王者结算界面 0~16 分，用于精细复盘） */
  rating?: number;
  /** 本局是否 MVP */
  isMvp?: boolean;
  /** 是否金牌/银牌（结算界面标记） */
  medal?: 'GOLD' | 'SILVER' | 'BRONZE';
  note?: string;
}
