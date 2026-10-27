import { HeroAvatar } from '@/components/HeroAvatar';
import type { BpState, Side } from '@/types';
import { cn } from '@/lib/utils';
import { Shield, Sword } from 'lucide-react';

interface BpStageProps {
  state: BpState;
  activeSide: Side | null;
  /** 点击某个 ban/pick 槽位时触发（手动指定槽位输入英雄） */
  onSlotClick?: (side: Side, kind: 'ban' | 'pick', index: number) => void;
}

export function BpStage({ state, activeSide, onSlotClick }: BpStageProps) {
  const { blueBans, redBans, bluePicks, redPicks, userSide } = state;
  const isUserBlue = userSide === 'BLUE';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
      <TeamPanel
        side="BLUE"
        label={isUserBlue ? '我方（蓝方）' : '敌方（蓝方）'}
        icon={Shield}
        bans={blueBans}
        picks={bluePicks}
        isActive={activeSide === 'BLUE'}
        isMyTeam={isUserBlue}
        onSlotClick={onSlotClick}
      />

      <div className="hidden lg:flex items-center justify-center">
        <div className="relative w-px h-full bg-gradient-to-b from-transparent via-white/20 to-transparent" />
        <div className="absolute flex items-center justify-center w-8 h-8 rounded-full bg-ui-surface border border-white/10 shadow-surface">
          <span className="text-[10px] font-bold text-ui-muted">VS</span>
        </div>
      </div>

      <TeamPanel
        side="RED"
        label={isUserBlue ? '敌方（红方）' : '我方（红方）'}
        icon={Sword}
        bans={redBans}
        picks={redPicks}
        isActive={activeSide === 'RED'}
        isMyTeam={!isUserBlue}
        onSlotClick={onSlotClick}
      />
    </div>
  );
}

interface TeamPanelProps {
  side: Side;
  label: string;
  icon: React.ElementType;
  bans: string[];
  picks: string[];
  isActive: boolean;
  isMyTeam: boolean;
  onSlotClick?: (side: Side, kind: 'ban' | 'pick', index: number) => void;
}

function TeamPanel({
  side,
  label,
  icon: Icon,
  bans,
  picks,
  isActive,
  isMyTeam,
  onSlotClick,
}: TeamPanelProps) {
  const isBlue = side === 'BLUE';
  const banCount = bans.filter(Boolean).length;
  const pickCount = picks.filter(Boolean).length;
  const borderColor = isActive
    ? isBlue
      ? 'border-ui-primary/50 shadow-glow-blue'
      : 'border-ui-danger/50 shadow-glow-red'
    : 'border-white/8 hover:border-white/12';

  return (
    <div
      className={cn(
        'rounded-2xl p-3 md:p-4 border bg-ui-surface/60 backdrop-blur-sm transition-all duration-300',
        borderColor
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-7 h-7 rounded-lg flex items-center justify-center',
              isBlue
                ? 'bg-ui-primary/15 text-ui-primary-light'
                : 'bg-ui-danger/15 text-ui-danger'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-bold text-ui-text">{label}</span>
        </div>
        {isActive && (
          <span
            className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-bold animate-pulse',
              isBlue
                ? 'bg-ui-primary/15 text-ui-primary-light border border-ui-primary/30'
                : 'bg-ui-danger/15 text-ui-danger border border-ui-danger/30'
            )}
          >
            行动中
          </span>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-[11px] font-semibold text-ui-muted-subtle uppercase tracking-wider mb-2">
            禁用 · {banCount}/5
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {Array.from({ length: 5 }).map((_, i) => {
              const heroId = bans[i];
              return (
                <button
                  key={`ban-${side}-${i}`}
                  onClick={() => onSlotClick?.(side, 'ban', i)}
                  className="rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ui-accent/50"
                  title="点击手动指定该 ban 位"
                >
                  <HeroAvatar
                    heroId={heroId}
                    size="sm"
                    variant={isBlue ? 'blue' : 'red'}
                    emptyLabel="?"
                    dimmed={!heroId}
                    banned={!!heroId}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-ui-muted-subtle uppercase tracking-wider mb-2">
            选择 · {pickCount}/5
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => {
              const heroId = picks[i];
              return (
                <button
                  key={`pick-${side}-${i}`}
                  onClick={() => onSlotClick?.(side, 'pick', i)}
                  className="rounded-xl transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ui-accent/50"
                  title="点击手动指定该 pick 位"
                >
                  <HeroAvatar
                    heroId={heroId}
                    size="md"
                    variant={isBlue ? 'blue' : 'red'}
                    emptyLabel="?"
                    dimmed={!heroId}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
