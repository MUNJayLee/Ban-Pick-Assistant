import { cn } from '@/lib/utils';

interface WinRateBadgeProps {
  winRate: number;
  tier?: string;
  tierScore?: number;
  size?: 'sm' | 'md';
}

/**
 * 梯度评级的颜色配置
 */
function getTierStyle(tier: string | undefined): {
  bg: string;
  text: string;
  border: string;
} {
  if (!tier) return { bg: 'bg-white/8', text: 'text-ui-muted', border: 'border-white/12' };
  if (tier === 'T0') return { bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-400/30' };
  if (tier === 'T0.5') return { bg: 'bg-orange-500/12', text: 'text-orange-300', border: 'border-orange-400/25' };
  if (tier === 'T1') return { bg: 'bg-emerald-500/12', text: 'text-emerald-300', border: 'border-emerald-400/25' };
  if (tier === 'T2') return { bg: 'bg-sky-500/12', text: 'text-sky-300', border: 'border-sky-400/25' };
  if (tier === 'T3') return { bg: 'bg-white/8', text: 'text-ui-muted', border: 'border-white/12' };
  return { bg: 'bg-white/5', text: 'text-ui-muted/60', border: 'border-white/8' };
}

export function WinRateBadge({ winRate, tier, tierScore, size = 'sm' }: WinRateBadgeProps) {
  // 如果有梯度评级，优先展示
  if (tier) {
    const style = getTierStyle(tier);
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full font-semibold border',
          size === 'sm' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs',
          style.bg,
          style.text,
          style.border
        )}
        title={tierScore !== undefined ? `梯度评分 ${tierScore}` : undefined}
      >
        {tier}
      </span>
    );
  }

  // 兼容旧数据：无梯度时仍展示胜率
  const percent = Math.round(winRate * 100);
  const isHigh = winRate >= 0.53;
  const isLow = winRate <= 0.47;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold border',
        size === 'sm' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs',
        isHigh
          ? 'bg-emerald-500/12 text-emerald-300 border-emerald-400/25'
          : isLow
          ? 'bg-rose-500/12 text-rose-300 border-rose-400/25'
          : 'bg-white/8 text-ui-muted border-white/12'
      )}
    >
      {percent}%
    </span>
  );
}
