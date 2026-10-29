import { useState } from 'react';
import { Ban, Trophy, Sparkles, ThumbsUp, ThumbsDown, AlertTriangle, CheckCircle2, Plus } from 'lucide-react';
import { HeroAvatar } from '@/components/HeroAvatar';
import { PositionBadge } from '@/components/PositionBadge';
import type { HeroRecommendation, BpPhase, BpState } from '@/types';
import { cn } from '@/lib/utils';
import { getHeroById } from '@/services/heroService';
import { uploadFeedback } from '@/services/syncService';
import { positionLabel, type GroupedResult } from '@/services/recommendation';
import { PICK_SEQUENCE } from '@/data/config';

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

/** 下一个要填入的槽位文案（「一键填入」提示用）。 */
function nextSlotLabel(state?: BpState, isMyTurn?: boolean): string | null {
  if (!state || !isMyTurn) return null;
  const mySide = state.userSide;
  const myBans = mySide === 'BLUE' ? state.blueBans : state.redBans;
  const enemySide = mySide === 'BLUE' ? 'RED' : 'BLUE';
  const enemyBans = enemySide === 'BLUE' ? state.blueBans : state.redBans;
  if (state.phase === 'MY_BAN') {
    return myBans.length >= 5 ? '我方 Ban 已满' : `我方 Ban 第 ${myBans.length + 1} 位`;
  }
  if (state.phase === 'ENEMY_BAN') {
    return enemyBans.length >= 5 ? '敌方 Ban 已满' : `敌方 Ban 第 ${enemyBans.length + 1} 位`;
  }
  if (state.phase === 'PICK') {
    const turn = PICK_SEQUENCE[state.pickTurnIndex];
    if (!turn) return null;
    return turn.side === mySide ? `我方 ${turn.description}` : `敌方 ${turn.description}`;
  }
  return null;
}

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

      {/* 一键填入 + 推荐反馈 */}
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <span className="text-[9px] text-ui-muted-subtle">点击卡片一键填入</span>
        <div className="flex items-center gap-1">
          {onSelect && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelect(rec.heroId);
              }}
              className="inline-flex items-center gap-0.5 rounded-md border border-ui-primary/25 bg-ui-primary/15 px-1.5 py-0.5 text-[9px] font-semibold text-ui-primary-light transition-colors hover:bg-ui-primary/25"
              title="一键填入我方阵容"
            >
              <Plus className="h-2.5 w-2.5" />
              填入
            </button>
          )}
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={(e) => onFeedback(e, rec.heroId, true)}
              className={cn(
                'p-1 rounded transition-colors',
                feedback[rec.heroId] === 'up'
                  ? 'text-ui-success bg-ui-success/15'
                  : 'text-ui-muted hover:text-ui-success hover:bg-ui-success/10',
              )}
              title="推荐有用"
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
              title="推荐不准"
            >
              <ThumbsDown className="w-3 h-3" />
            </button>
          </div>
        </div>
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
  const targetSlot = nextSlotLabel(state, isMyTurn);

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
        {targetSlot && (
          <p className="mt-1 inline-flex items-center gap-1 rounded-md border border-ui-accent/20 bg-ui-accent/10 px-1.5 py-0.5 text-[10px] text-ui-accent">
            <Plus className="h-3 w-3" />
            点击推荐一键填入：{targetSlot}
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
            {/* 缺位高亮：缺哪路用红色徽章醒目提示 */}
            {grouped!.gap.covered.length === 0 ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-ui-accent/25 bg-ui-accent/10 px-2.5 py-1.5">
                <Sparkles className="h-3.5 w-3.5 text-ui-accent" />
                <span className="text-[10px] font-bold text-ui-accent">尚未选择英雄</span>
                <span className="ml-auto text-[9px] text-ui-accent/70">推荐将按分路补齐</span>
              </div>
            ) : grouped!.gap.missing.length > 0 ? (
              <div className="rounded-xl border border-ui-danger/30 bg-ui-danger/10 px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-ui-danger" />
                  <span className="text-[11px] font-bold text-ui-danger">阵容缺口</span>
                  <span className="text-[9px] text-ui-danger/70">补位优先</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {grouped!.gap.missing.map((p) => (
                    <span
                      key={p}
                      className="rounded border border-ui-danger/30 bg-ui-danger/20 px-1.5 py-0.5 text-[10px] font-bold text-ui-danger"
                    >
                      缺 {positionLabel(p)}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-lg border border-ui-success/25 bg-ui-success/10 px-2.5 py-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-ui-success" />
                <span className="text-[10px] font-bold text-ui-success">五路齐全</span>
                <span className="ml-auto text-[9px] text-ui-success/70">优先补强 / 克制位</span>
              </div>
            )}

            {/* 按分路分组 */}
            {grouped!.groups.map((g) => {
              const coveredNames = (grouped!.gap.coverage[g.position] ?? [])
                .map((id) => getHeroById(id)?.name || id)
                .join('/');
              return (
                <div key={g.position} className="space-y-1.5">
                  <div
                    className={cn(
                      'flex items-center gap-1.5 px-1 pt-1',
                      g.isMissing && 'rounded-lg border border-ui-danger/20 bg-ui-danger/10 px-2 py-1',
                    )}
                  >
                    <span className={cn('text-[11px] font-bold', g.isMissing ? 'text-ui-danger' : 'text-ui-text')}>
                      {g.positionLabel}
                    </span>
                    {g.isMissing ? (
                      <span className="rounded border border-ui-danger/30 bg-ui-danger/20 px-1.5 py-0.5 text-[9px] font-bold text-ui-danger">
                        缺
                      </span>
                    ) : (
                      <span className="truncate text-[9px] text-ui-muted-subtle">已选 {coveredNames || '-'}</span>
                    )}
                    <span className="ml-auto shrink-0 text-[9px] text-ui-muted/60">{g.heroes.length} 候选</span>
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
              );
            })}
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
