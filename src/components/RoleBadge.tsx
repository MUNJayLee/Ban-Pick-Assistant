import { cn } from '@/lib/utils';
import { ROLE_LABELS } from '@/data/config';
import type { HeroRole } from '@/types';

interface RoleBadgeProps {
  role: HeroRole;
  size?: 'xs' | 'sm';
}

export function RoleBadge({ role, size = 'sm' }: RoleBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md font-semibold border',
        size === 'xs' ? 'px-1 py-0 text-[9px]' : 'px-1.5 py-0.5 text-[10px]',
        roleStyle(role)
      )}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

function roleStyle(role: HeroRole) {
  switch (role) {
    case 'TANK':
      return 'bg-emerald-500/12 text-emerald-300 border-emerald-400/20';
    case 'WARRIOR':
      return 'bg-amber-500/12 text-amber-300 border-amber-400/20';
    case 'ASSASSIN':
      return 'bg-rose-500/12 text-rose-300 border-rose-400/20';
    case 'MAGE':
      return 'bg-violet-500/12 text-violet-300 border-violet-400/20';
    case 'MARKSMAN':
      return 'bg-yellow-400/12 text-yellow-200 border-yellow-300/20';
    case 'SUPPORT':
      return 'bg-cyan-500/12 text-cyan-300 border-cyan-400/20';
    default:
      return 'bg-white/8 text-ui-muted border-white/10';
  }
}
