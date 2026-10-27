/**
 * 兼容性出口：推荐逻辑已迁移到 src/services/recommendation/ 下的策略引擎。
 * 保留此文件是为了让既有 import 路径（@/services/recommendationService）继续可用。
 */
export {
  recommendHeroes,
  getRecommendationReason,
} from '@/services/recommendation';
