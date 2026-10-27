import { RefreshCcw, Undo2, Shield, Sword } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Side } from '@/types';

interface BpHeaderProps {
  userSide: Side;
  onSideChange: (side: Side) => void;
  onReset: () => void;
  onUndo: () => void;
  canUndo: boolean;
}

export function BpHeader({
  userSide,
  onSideChange,
  onReset,
  onUndo,
  canUndo,
}: BpHeaderProps) {
  const isBlue = userSide === 'BLUE';

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-ui-bg-elevated/60 border-b border-white/5">
      <div className="flex items-center gap-2">
        <SideToggle active={isBlue} onClick={() => onSideChange('BLUE')}>
          <Shield className="w-3.5 h-3.5" />
          <span>蓝方</span>
        </SideToggle>
        <SideToggle active={!isBlue} onClick={() => onSideChange('RED')}>
          <Sword className="w-3.5 h-3.5" />
          <span>红方</span>
        </SideToggle>
      </div>

      <div className="flex items-center gap-2">
        <ActionButton onClick={onUndo} disabled={!canUndo} title="撤销上一步">
          <Undo2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">撤销</span>
        </ActionButton>
        <ActionButton onClick={onReset} title="重置当前 BP">
          <RefreshCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">重置</span>
        </ActionButton>
      </div>
    </div>
  );
}

function SideToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 border',
        active
          ? 'bg-ui-primary text-white border-ui-primary shadow-glow-blue'
          : 'bg-ui-surface text-ui-muted border-white/8 hover:text-ui-text hover:bg-white/5'
      )}
    >
      {children}
    </button>
  );
}

function ActionButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-200',
        disabled
          ? 'bg-ui-surface/50 text-ui-muted-subtle border-white/5 cursor-not-allowed'
          : 'bg-ui-surface text-ui-muted border-white/8 hover:text-ui-text hover:bg-white/5 hover:border-white/14'
      )}
    >
      {children}
    </button>
  );
}
