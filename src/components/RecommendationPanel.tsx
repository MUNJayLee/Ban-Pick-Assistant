import { useState } from 'react';
import {
  Ban,
  Trophy,
  Sparkles,
  ChevronRight,
  MousePointer,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { HeroAvatar } from '@/components/HeroAvatar';
import { PositionBadge } from '@/components/PositionBadge';
import type { HeroRecommendation, BpPhase, BpState } from '@/types';
import { cn } from '@/lib/utils';
import { getHeroById } from '@/services/heroService';
import { uploadFeedback } from '@/services/syncService';

interface RecommendationPanelProps {
  recommendations: HeroRecommendation[];
  phase: BpPhase;
  isMyTurn: boolean;
  operator?: { name: string; role: string } | null;
  onSelect?: (heroId: string) => void;
  state?: BpState;
}

export function RecommendationPanel({
  recommendations,
  phase,
  isMyTurn,
  operator,
  onSelect,
  state,
}: RecommendationPanelProps) {
  const title = phase === 'MY_BAN' ? '建议禁用' : phase === 'PICK' ? '实时推荐' : '等待敌方';
  const Icon = phase === 'MY_BAN' ? Ban : phase === 'PICK' ? Trophy : Sparkles;

  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>({});

  const handleFeedback = (e: React.MouseEvent, heroId: string, helpful: boolean) => {
    e.stopPropagation();
    const next: 'up' | 'down' = helpful ? 'up' : 'down';
    setFeedback((prev) => {
      const cur = prev[heroId];
      const updated = { ...prev };
      if (cur === next) delete updated[heroId];
      else updated[heroId] = next;
      return updated;
    });
    void uploadFeedback({
      heroId,
      phase: phase === 'MY_BAN' ? 'BAN' : 'PICK',
      helpful,
      context: state
        ? {
            bluePicks: state.bluePicks,
            redPicks: state.redPicks,
            blueBans: state.blueBans,
            redBans: state.redBans,
            pickTurnIndex: state.pickTurnIndex,
            userSide: state.userSide,
          }
        : {},
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none p-3 md:p-4 border-b border-white/5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-ui-primary to-ui-accent flex items-center justify-center shadow-glow-blue">
            <Icon className="w-3.5 h-3.5 text-white" />
          </div>
          <h3 className="text-sm font-bold text-ui-text">{title}</h3>
        </div>

        {operator && isMyTurn && (
          <p className="text-[11px] text-ui-muted mt-1">
            当前操作：<span className="text-ui-primary-light font-semibold">{operator.name}</span>
            <span className="text-ui-muted-subtle">（{operator.role}）</span>
          </p>
        )}
        {!isMyTurn && phase !== 'FINISHED' && (
          <p className="text-[11px] text-ui-muted-subtle mt-1">
            非我方操作，可输入对方选择或等待切换
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2">
        {recommendations.length === 0 ? (
          <EmptyState phase={phase} isMyTurn={isMyTurn} />
        ) : (
          recommendations.map((rec, index) => {
            const hero = getHeroById(rec.heroId);
            if (!hero) return null;
            const rank = rec.rank ?? index + 1;
            return (
              <div
                key={rec.heroId}
                role="button"
                tabIndex={0}
                onClick={() => onSelect?.(rec.heroId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect?.(rec.heroId);
                }}
                className={cn(
                  'w-full text-left rounded-xl border p-2.5 transition-all duration-200 group animate-slide-up cursor-pointer',
                  'bg-ui-surface/60 border-white/8 hover:border-ui-primary/40 hover:bg-ui-surface hover:shadow-surface',
                  index === 0 && 'border-ui-primary/40 bg-ui-primary/8 ring-1 ring-ui-primary/10'
                )}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <HeroAvatar heroId={rec.heroId} size="md" />
                    <span
                      className={cn(
                        'absolute -top-1 -left-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white border border-white/10',
                        index === 0
                          ? 'bg-gradient-to-br from-ui-primary to-ui-accent shadow-glow-blue'
                          : 'bg-ui-surface-elevated'
                      )}
                    >
                      {rank}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold text-ui-text truncate">{hero.name}</p>
                      {hero.positions && hero.positions.length > 0
                        ? hero.positions.slice(0, 1).map((pos) => (
                            <PositionBadge key={pos} position={pos} size="xs" />
                          ))
                        : hero.positionLabel && (
                            <span className="text-[9px] text-ui-muted">{hero.positionLabel}</span>
                          )}
                    </div>
                    <p className="text-[11px] text-ui-muted line-clamp-2 mt-0.5">{rec.reason}</p>
                  </div>

                  <div className="flex flex-col items-end">
                    <span className="text-lg font-bold gradient-text font-mono">
                      {Math.round(rec.score)}
                    </span>
                    <span className="text-[9px] text-ui-muted-subtle">推荐指数</span>
                  </div>
                </div>

                {/* 推荐指数能量条 */}
                <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-ui-primary to-ui-accent transition-all"
                    style={{ width: `${Math.min(Math.max(rec.score, 0), 100)}%` }}
                  />
                </div>

                {/* 推荐反馈 */}
                <div
                  className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[10px] text-ui-muted-subtle">这条推荐：</span>
                  <button
                    onClick={(e) => handleFeedback(e, rec.heroId, true)}
                    className={cn(
                      'flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium border transition-colors',
                      feedback[rec.heroId] === 'up'
                        ? 'bg-ui-success/15 text-ui-success border-ui-success/30'
                        : 'text-ui-muted border-white/8 hover:text-ui-success hover:border-ui-success/30'
                    )}
                  >
                    <ThumbsUp className="w-3 h-3" />
                    准
                  </button>
                  <button
                    onClick={(e) => handleFeedback(e, rec.heroId, false)}
                    className={cn(
                      'flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium border transition-colors',
                      feedback[rec.heroId] === 'down'
                        ? 'bg-ui-danger/15 text-ui-danger border-ui-danger/30'
                        : 'text-ui-muted border-white/8 hover:text-ui-danger hover:border-ui-danger/30'
                    )}
                  >
                    <ThumbsDown className="w-3 h-3" />
                    不准
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function EmptyState({ phase, isMyTurn }: { phase: BpPhase; isMyTurn: boolean }) {
  if (phase === 'ENEMY_BAN') {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-ui-muted">
        <div className="w-12 h-12 rounded-2xl bg-ui-surface border border-white/8 flex items-center justify-center mb-3">
          <Ban className="w-5 h-5 text-ui-muted-subtle" />
        </div>
        <p className="text-sm font-semibold">等待敌方禁用</p>
        <p className="text-[11px] text-ui-muted-subtle mt-1">可继续通过英雄池输入对方 ban 位</p>
      </div>
    );
  }

  if (phase === 'PICK' && !isMyTurn) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-ui-muted">
        <div className="w-12 h-12 rounded-2xl bg-ui-surface border border-white/8 flex items-center justify-center mb-3">
          <MousePointer className="w-5 h-5 text-ui-muted-subtle" />
        </div>
        <p className="text-sm font-semibold">当前非我方选英雄</p>
        <p className="text-[11px] text-ui-muted-subtle mt-1">可在左侧记录对方 pick</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-10 text-center text-ui-muted">
      <div className="w-12 h-12 rounded-2xl bg-ui-surface border border-white/8 flex items-center justify-center mb-3">
        <Sparkles className="w-5 h-5 text-ui-muted-subtle" />
      </div>
      <p className="text-sm font-semibold">暂无推荐</p>
      <p className="text-[11px] text-ui-muted-subtle mt-1">继续操作以获取 AI 建议</p>
    </div>
  );
}
