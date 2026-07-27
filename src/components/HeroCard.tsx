import { HeroAvatar } from '@/components/HeroAvatar';
import { PositionBadge } from '@/components/PositionBadge';
import { WinRateBadge } from '@/components/WinRateBadge';
import type { Hero, HeroRecommendation } from '@/types';
import { cn } from '@/lib/utils';

interface HeroCardProps {
  hero: Hero;
  recommendation?: HeroRecommendation;
  rank?: number;
  disabled?: boolean;
  banned?: boolean;
  selected?: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}

export function HeroCard({
  hero,
  recommendation,
  rank,
  disabled = false,
  banned = false,
  selected = false,
  onClick,
  style,
}: HeroCardProps) {
  const recReason = recommendation?.reason;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={cn(
        'group relative flex flex-col items-center text-center rounded-2xl p-2 md:p-3 border transition-all duration-200 animate-slide-up',
        'focus:outline-none focus:ring-2 focus:ring-trae-primary/30 focus:ring-offset-2 focus:ring-offset-trae-bg',
        disabled && !banned && !selected
          ? 'opacity-40 cursor-not-allowed bg-trae-surface/40 border-white/5'
          : 'bg-trae-surface/70 border-white/8 hover:border-trae-primary/40 hover:bg-trae-surface hover:shadow-surface hover:-translate-y-0.5',
        banned && 'border-trae-danger/40 bg-trae-danger/8 opacity-70',
        selected && !banned && 'border-trae-primary/50 bg-trae-primary/10 shadow-glow-blue',
        recommendation && !banned && !selected && 'border-trae-primary/30 ring-1 ring-trae-primary/10'
      )}
    >
      {/* Recommended badge */}
      {recommendation && !banned && !selected && (
        <div className="absolute -top-1.5 -right-1.5 z-20">
          <span className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-gradient-to-r from-trae-primary to-trae-accent text-[10px] font-bold text-white shadow-glow-blue border border-white/10">
            {rank ?? recommendation?.rank ?? '?'}
          </span>
        </div>
      )}

      {/* Banned / Selected overlay */}
      {banned && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-trae-bg/45">
          <span className="px-2 py-0.5 rounded-md bg-trae-danger/90 text-white text-[10px] font-bold shadow-glow-red">
            已禁用
          </span>
        </div>
      )}
      {selected && !banned && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-trae-bg/45">
          <span className="px-2 py-0.5 rounded-md bg-trae-primary/90 text-white text-[10px] font-bold shadow-glow-blue">
            已选择
          </span>
        </div>
      )}

      <HeroAvatar heroId={hero.id} size="lg" showTooltip={false} />

      <div className="mt-2 w-full min-w-0">
        <p className="text-xs font-semibold text-trae-text truncate leading-tight">
          {hero.name}
        </p>
        <div className="flex items-center justify-center gap-1 mt-1 flex-wrap">
          {hero.positions && hero.positions.length > 0
            ? hero.positions.map((pos) => (
                <PositionBadge key={pos} position={pos} size="xs" />
              ))
            : hero.positionLabel && (
                <span className="text-[9px] text-trae-muted/70 truncate">{hero.positionLabel}</span>
              )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-center gap-1.5">
        <WinRateBadge winRate={hero.aiWinRate} tier={hero.tier} tierScore={hero.tierScore} size="sm" />
      </div>

      {recReason && !banned && !selected && (
        <p className="mt-2 text-[10px] text-trae-muted leading-snug line-clamp-2 min-h-[1.75rem]">
          {recReason}
        </p>
      )}
    </button>
  );
}
