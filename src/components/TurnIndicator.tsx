import { cn } from '@/lib/utils';
import type { BpPhase, Side } from '@/types';

interface TurnIndicatorProps {
  phase: BpPhase;
  activeSide: Side | null;
  phaseLabel: string;
  isMyTurn: boolean;
  myBanCount: number;
  enemyBanCount: number;
  pickTurnIndex: number;
  totalPicks: number;
}

export function TurnIndicator({
  phase,
  activeSide,
  phaseLabel,
  isMyTurn,
  myBanCount,
  enemyBanCount,
  pickTurnIndex,
  totalPicks,
}: TurnIndicatorProps) {
  const progress = (() => {
    if (phase === 'MY_BAN') return (myBanCount / 5) * 50;
    if (phase === 'ENEMY_BAN') return 50 + (enemyBanCount / 5) * 50;
    if (phase === 'PICK') return 100;
    return 100;
  })();

  const isBlueTurn = activeSide === 'BLUE';

  return (
    <div
      className={cn(
        'relative inline-flex flex-col items-center rounded-2xl px-5 py-2.5 border backdrop-blur-md overflow-hidden transition-all duration-300',
        isMyTurn
          ? 'bg-gradient-to-r from-ui-primary/12 via-ui-accent/8 to-ui-purple/10 border-ui-primary/30 shadow-glow-blue'
          : 'bg-ui-surface/70 border-white/10 shadow-surface'
      )}
    >
      {/* progress bar */}
      <div className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-ui-primary via-ui-accent to-ui-purple transition-all duration-500" style={{ width: `${progress}%` }} />

      <div className="flex items-center gap-2 z-10">
        <span
          className={cn(
            'w-2 h-2 rounded-full animate-pulse',
            isBlueTurn ? 'bg-ui-primary' : 'bg-ui-danger'
          )}
        />
        <span className="text-xs md:text-sm font-bold text-ui-text">
          {phaseLabel}
        </span>
        {phase === 'PICK' && (
          <span className="text-[11px] text-ui-muted font-mono">
            {Math.min(pickTurnIndex + 1, totalPicks)} / {totalPicks}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 mt-1 z-10">
        <PhaseDot active={phase === 'MY_BAN'} label="我方禁用" count={myBanCount} />
        <PhaseDot active={phase === 'ENEMY_BAN'} label="敌方禁用" count={enemyBanCount} />
        <PhaseDot active={phase === 'PICK'} label="选英雄" count={pickTurnIndex} total={totalPicks} />
      </div>
    </div>
  );
}

function PhaseDot({
  active,
  label,
  count,
  total,
}: {
  active: boolean;
  label: string;
  count: number;
  total?: number;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={cn(
          'w-2 h-2 rounded-full transition-all duration-200',
          active ? 'bg-ui-primary shadow-glow-blue scale-125' : 'bg-white/15'
        )}
      />
      <span
        className={cn(
          'text-[10px] font-medium transition-colors',
          active ? 'text-ui-text' : 'text-ui-muted-subtle'
        )}
      >
        {label}
      </span>
    </div>
  );
}
