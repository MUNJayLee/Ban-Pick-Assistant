import { useState } from 'react';
import { Ban, Trophy, Sparkles, ThumbsUp, ThumbsDown } from 'lucide-react';
import { HeroAvatar } from '@/components/HeroAvatar';
import { PositionBadge } from '@/components/PositionBadge';
import type { HeroRecommendation, BpPhase, BpState } from '@/types';
import { cn } from '@/lib/utils';
import { getHeroById } from '@/services/heroService';
import { uploadFeedback } from '@/services/syncService';
import { positionLabel, type GroupedResult } from '@/services/recommendation';

interface RecommendationPanelProps {
  recommendations: HeroRecommendation[];
  /** 按分路分组的推荐（有则优先展示分组视图） */
  grouped?: GroupedResult | null;
  phase: BpPhase;
  isMyTurn: boolean;
  operator?: { name: string; role: string } | null;
  onSelect?: (heroId: string) => void;
  state?: BpState;
}

type FeedbackMap = Record<string, 'up' | 'down'>;

/** 单条推荐卡片。 */
function HeroRow({
  rec,
  index,
  onSelect,
  feedback,
  onFeedback,
}: {
  rec: HeroRecommendation;
  index: number;
  onSelect?: (heroId: string) => void;
  feedback: FeedbackMap;
  onFeedback: (e: React.MouseEvent, heroId: string, helpful: boolean) => void;
}) {
  const hero = getHeroById(rec.heroId);
  if (!hero) return null;
  const rank = rec.rank ?? index + 1;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(rec.heroId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect?.(rec.heroId);
      }}
      className={cn(
        'w-full text-left rounded-xl border p-2.5 transition-all duration-200 group animate-slide-up cursor-pointer',
        'bg-ui-surface/60 border-white/8 hover:border-ui-primary/40 hover:bg-ui-surface hover:shadow-surface',
        index === 0 && 'border-ui-primary/40 bg-ui-primary/8 ring-1 ring-ui-primary/10',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="relative">
          <HeroAvatar heroId={rec.heroId} size="md" />
          <span
            className={cn(
              'absolute -top-1 -left-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white border border-white/10',
              index === 0
                ? 'bg-gradient-to-br from-ui-primary to-ui-accent shadow-glow-blue'
                : 'bg-ui-surface-elevated',
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
          style={{ width: `${Math.min(100, rec.score)}%` }}
        />
      </div>

      {/* 推荐反馈 */}
      <div className="mt-1.5 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[9px] text-ui-muted-subtle mr-1">这条推荐</span>
        <button
          onClick={(e) => onFeedback(e, rec.heroId, true)}
          className={cn(
            'p-1 rounded transition-colors',
            feedback[rec.heroId] === 'up'
              ? 'text-ui-success bg-ui-success/15'
              : 'text-ui-muted hover:text-ui-success hover:bg-ui-success/10',
          )}
        >
          <ThumbsUp className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => onFeedback(e, rec.heroId, false)}
          className={cn(
            'p-1 rounded transition-colors',
            feedback[rec.heroId] === 'down'
              ? 'text-ui-danger bg-ui-danger/15'
              : 'text-ui-muted hover:text-ui-danger hover:bg-ui-danger/10',
          )}
        >
          <ThumbsDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export function RecommendationPanel({
  recommendations,
  grouped,
  phase,
  isMyTurn,
  operator,
  onSelect,
  state,
}: RecommendationPanelProps) {
  const title = phase === 'MY_BAN' ? '建议禁用' : phase === 'PICK' ? '实时推荐' : '等待对方';
  const Icon = phase === 'MY_BAN' ? Ban : phase === 'PICK' ? Trophy : Sparkles;

  const [feedback, setFeedback] = useState<FeedbackMap>({});

  const handleFeedback = (e: React.MouseEvent, heroId: string, helpful: boolean) => {
    e.stopPropagation();
    const next: 'up' | 'down' = helpful ? 'up' : 'down';
    setFeedback((prev) => ({ ...prev, [heroId]: next }));
    void uploadFeedback({
      heroId,
      helpful,
      phase: phase === 'PICK' ? 'PICK' : 'BAN',
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

  const hasGroups = Boolean(grouped && grouped.groups.length > 0);

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
        {hasGroups ? (
          <>
            {/* 缺位提示 */}
            {grouped!.gap.missing.length > 0 && (
              <div className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-400/25 flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-amber-300">我方缺位</span>
                <span className="text-[11px] text-amber-200/90">
                  {grouped!.gap.missing.map((p) => positionLabel(p)).join('、')}
                </span>
              </div>
            )}

            {/* 按分路分组 */}
            {grouped!.groups.map((g) => (
              <div key={g.position} className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1 pt-1">
                  <span className="text-[11px] font-bold text-ui-text">{g.positionLabel}</span>
                  {g.isMissing && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30">
                      缺
                    </span>
                  )}
                  <span className="text-[9px] text-ui-muted/60 ml-auto">{g.heroes.length} 候选</span>
                </div>
                {g.heroes.map((rec, i) => (
                  <HeroRow
                    key={`${g.position}-${rec.heroId}`}
                    rec={rec}
                    index={i}
                    onSelect={onSelect}
                    feedback={feedback}
                    onFeedback={handleFeedback}
                  />
                ))}
              </div>
            ))}
          </>
        ) : recommendations.length === 0 ? (
          <EmptyState phase={phase} isMyTurn={isMyTurn} />
        ) : (
          recommendations.map((rec, index) => (
            <HeroRow
              key={rec.heroId}
              rec={rec}
              index={index}
              onSelect={onSelect}
              feedback={feedback}
              onFeedback={handleFeedback}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ phase, isMyTurn }: { phase: BpPhase; isMyTurn: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-10 h-10 rounded-xl bg-ui-surface/60 flex items-center justify-center mb-2">
        <Sparkles className="w-5 h-5 text-ui-muted" />
      </div>
      <p className="text-xs text-ui-muted">
        {!isMyTurn
          ? '等待我方操作轮次'
          : phase === 'ENEMY_BAN'
          ? '敌方正在禁用'
          : phase === 'FINISHED'
          ? 'BP 已结束'
          : '暂无推荐'}
      </p>
    </div>
  );
}
