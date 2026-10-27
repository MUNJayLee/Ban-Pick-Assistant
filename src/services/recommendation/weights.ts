/**
 * 推荐策略权重配置。
 *
 * 设计约定：
 * - 所有正向因子权重之和约为 1（version + counter + synergy + position + pressure + gap）。
 * - penalty 作为负向因子单独扣除（值越大，被克制时扣分越狠）。
 * - 调整这里的数值即可改变推荐倾向，无需改动算法逻辑。
 */

export interface RecommendationWeights {
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

export const PICK_WEIGHTS: RecommendationWeights = {
  version: 0.20,      // 版本强度（天元之弈 tierScore）
  counter: 0.22,      // 克制敌方（对线胜率 + 敌核加权）
  synergy: 0.10,      // 协同我方
  antiSynergy: 0.06,  // 冲突我方（负向）
  position: 0.12,     // 分路适配（缺位优先，已由 positionFit 处理）
  pressure: 0.04,     // 抢位压力
  gap: 0.06,          // 阵容结构缺口
  penalty: 0.20,      // 被克制（负向，同样用对线胜率）
};

/** Ban 阶段权重：版本强度 + 对我方威胁 + 对方抢位概率。 */
export const BAN_WEIGHTS = {
  version: 0.5,
  threat: 0.3,
  contested: 0.2,
};
