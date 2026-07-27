import { getHeroById } from '@/services/heroService';
import { cn } from '@/lib/utils';
import type { HeroRole } from '@/types';

interface HeroAvatarProps {
  heroId?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'blue' | 'red' | 'neutral';
  emptyLabel?: string;
  dimmed?: boolean;
  banned?: boolean;
  showTooltip?: boolean;
  ring?: boolean;
}

const SIZE_MAP = {
  sm: 'w-8 h-8 text-[10px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-14 h-14 md:w-16 md:h-16 text-sm',
  xl: 'w-20 h-20 md:w-24 md:h-24 text-lg',
};

const BORDER_MAP = {
  blue: 'border-trae-primary/40 shadow-glow-blue',
  red: 'border-trae-danger/40 shadow-glow-red',
  neutral: 'border-white/10',
};

export function HeroAvatar({
  heroId,
  size = 'md',
  variant = 'neutral',
  emptyLabel,
  dimmed = false,
  banned = false,
  showTooltip = true,
  ring = false,
}: HeroAvatarProps) {
  const hero = heroId ? getHeroById(heroId) : undefined;
  const sizeClasses = SIZE_MAP[size];
  const borderClasses = BORDER_MAP[variant];

  if (!hero) {
    return (
      <div
        className={cn(
          'relative rounded-xl flex items-center justify-center border bg-trae-surface text-trae-muted font-bold select-none overflow-hidden',
          sizeClasses,
          borderClasses,
          dimmed && 'opacity-35',
        ring && 'ring-2 ring-trae-primary/30 ring-offset-2 ring-offset-trae-bg'
      )}
    >
        <span className="relative z-10">{emptyLabel || '?'}</span>
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />
      </div>
    );
  }

  const initial = hero.name.charAt(0);

  return (
    <div
      className={cn(
        'relative rounded-xl overflow-hidden border flex items-center justify-center shrink-0 select-none transition-all duration-200',
        sizeClasses,
        borderClasses,
        dimmed && 'opacity-40 grayscale',
        banned && 'opacity-60',
        ring && 'ring-2 ring-trae-primary/30 ring-offset-2 ring-offset-trae-bg'
      )}
      title={showTooltip ? `${hero.name}${hero.title ? ` · ${hero.title}` : ''}` : undefined}
    >
      {/* Gradient background based on role color */}
      <div
        className={cn(
          'absolute inset-0',
          roleGradient(hero.roles[0])
        )}
      />
      <span className="relative z-10 font-bold text-white drop-shadow-md">
        {initial}
      </span>

      {banned && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-trae-bg/60">
          <div className="w-full h-0.5 bg-trae-danger rotate-45 shadow-glow-red" />
        </div>
      )}
    </div>
  );
}

function roleGradient(role?: HeroRole) {
  switch (role) {
    case 'TANK':
      return 'bg-gradient-to-br from-emerald-500/80 to-teal-700/80';
    case 'WARRIOR':
      return 'bg-gradient-to-br from-amber-500/80 to-orange-700/80';
    case 'ASSASSIN':
      return 'bg-gradient-to-br from-rose-500/80 to-red-700/80';
    case 'MAGE':
      return 'bg-gradient-to-br from-violet-500/80 to-purple-700/80';
    case 'MARKSMAN':
      return 'bg-gradient-to-br from-yellow-400/80 to-amber-600/80';
    case 'SUPPORT':
      return 'bg-gradient-to-br from-cyan-400/80 to-blue-600/80';
    default:
      return 'bg-gradient-to-br from-slate-500/80 to-slate-700/80';
  }
}
