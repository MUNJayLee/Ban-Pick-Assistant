import { cn } from '@/lib/utils';
import { POSITION_LABELS } from '@/types';
import type { HeroPosition } from '@/types';

interface PositionBadgeProps {
  position: HeroPosition;
  size?: 'xs' | 'sm';
}

/**
 * 位置标签的颜色配置
 */
function getPositionStyle(position: HeroPosition): {
  bg: string;
  text: string;
} {
  switch (position) {
    case 'CLASH_LANE':
      return { bg: 'bg-amber-500/10', text: 'text-amber-400' };
    case 'MID_LANE':
      return { bg: 'bg-purple-500/10', text: 'text-purple-400' };
    case 'FARM_LANE':
      return { bg: 'bg-red-500/10', text: 'text-red-400' };
    case 'JUNGLE':
      return { bg: 'bg-emerald-500/10', text: 'text-emerald-400' };
    case 'ROAM':
      return { bg: 'bg-sky-500/10', text: 'text-sky-400' };
    default:
      return { bg: 'bg-white/8', text: 'text-trae-muted' };
  }
}

export function PositionBadge({ position, size = 'sm' }: PositionBadgeProps) {
  const style = getPositionStyle(position);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md font-medium',
        size === 'xs' ? 'px-1 py-0 text-[9px]' : 'px-1.5 py-0.5 text-[10px]',
        style.bg,
        style.text
      )}
    >
      {POSITION_LABELS[position]}
    </span>
  );
}
