import { HeroAvatar } from '@/components/HeroAvatar';
import type { BpState, HeroRole, Side } from '@/types';
import { cn } from '@/lib/utils';
import { BLUE_SLOTS, RED_SLOTS } from '@/data/config';
import { Shield, Sword } from 'lucide-react';

interface BpStageProps {
  state: BpState;
  activeSide: Side | null;
}

export function BpStage({ state, activeSide }: BpStageProps) {
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
        slots={BLUE_SLOTS}
      />

      <div className="hidden lg:flex items-center justify-center">
        <div className="relative w-px h-full bg-gradient-to-b from-transparent via-white/20 to-transparent" />
        <div className="absolute flex items-center justify-center w-8 h-8 rounded-full bg-trae-surface border border-white/10 shadow-surface">
          <span className="text-[10px] font-bold text-trae-muted">VS</span>
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
        slots={RED_SLOTS}
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
  slots: { role: HeroRole; label: string }[];
}

function TeamPanel({
  side,
  label,
  icon: Icon,
  bans,
  picks,
  isActive,
  isMyTeam,
  slots,
}: TeamPanelProps) {
  const isBlue = side === 'BLUE';
  const borderColor = isActive
    ? isBlue
      ? 'border-trae-primary/50 shadow-glow-blue'
      : 'border-trae-danger/50 shadow-glow-red'
    : 'border-white/8 hover:border-white/12';

  return (
    <div
      className={cn(
        'rounded-2xl p-3 md:p-4 border bg-trae-surface/60 backdrop-blur-sm transition-all duration-300',
        borderColor
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-7 h-7 rounded-lg flex items-center justify-center',
              isBlue
                ? 'bg-trae-primary/15 text-trae-primary-light'
                : 'bg-trae-danger/15 text-trae-danger'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-bold text-trae-text">{label}</span>
        </div>
        {isActive && (
          <span
            className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-bold animate-pulse',
              isBlue
                ? 'bg-trae-primary/15 text-trae-primary-light border border-trae-primary/30'
                : 'bg-trae-danger/15 text-trae-danger border border-trae-danger/30'
            )}
          >
            行动中
          </span>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-[11px] font-semibold text-trae-muted-subtle uppercase tracking-wider mb-2">
            禁用 · {bans.length}/5
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {Array.from({ length: 5 }).map((_, i) => {
              const heroId = bans[i];
              return (
                <HeroAvatar
                  key={`ban-${side}-${i}`}
                  heroId={heroId}
                  size="sm"
                  variant={isBlue ? 'blue' : 'red'}
                  emptyLabel="?"
                  dimmed={!heroId}
                  banned={!!heroId}
                />
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-trae-muted-subtle uppercase tracking-wider mb-2">
            选择 · {picks.length}/5
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {slots.map((slot, i) => {
              const heroId = picks[i];
              return (
                <div key={`pick-${side}-${i}`} className="relative">
                  <HeroAvatar
                    heroId={heroId}
                    size="md"
                    variant={isBlue ? 'blue' : 'red'}
                    emptyLabel={slot.label.slice(0, 1)}
                    dimmed={!heroId}
                  />
                  {heroId && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] px-1 rounded bg-trae-bg-elevated/90 text-trae-muted border border-white/8 whitespace-nowrap z-10">
                      {slot.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
