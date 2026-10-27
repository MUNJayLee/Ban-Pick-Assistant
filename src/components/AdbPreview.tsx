import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { useBpSync } from '@/hooks/useBpSync';

const API = 'http://127.0.0.1:8900';

const PHASE_TEXT: Record<string, string> = {
  ban: '禁用阶段',
  pick: '选将阶段',
  final: 'BP 完成',
  other: '非 BP 界面',
};

interface Props {
  adb: ReturnType<typeof useBpSync>;
}

/**
 * BP 模拟页内嵌的「实时 ADB 画面」。
 * 监听中时每 2 秒自动刷新；非监听时可点「刷新」单次抓帧。
 */
export function AdbPreview({ adb }: Props) {
  const { info } = adb;
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFrame = useCallback(async () => {
    if (!info.device) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/capture`, { method: 'POST' }).then((x) => x.json());
      if (r.ok) {
        setImage(r.image);
        setSize({ w: r.width, h: r.height });
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }, [info.device]);

  // 监听中自动刷新
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (info.monitoring && info.device) {
      fetchFrame();
      timerRef.current = setInterval(fetchFrame, 2000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [info.monitoring, info.device, fetchFrame]);

  const phaseColor =
    info.phase === 'ban'
      ? 'text-rose-400'
      : info.phase === 'pick'
        ? 'text-sky-400'
        : info.phase === 'final'
          ? 'text-emerald-400'
          : 'text-ui-muted';

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/8">
        <Camera className="w-3.5 h-3.5 text-ui-primary" />
        <span className="text-[11px] font-semibold text-ui-text">ADB 实时画面</span>

        <span className={cn('text-[11px] font-semibold', phaseColor)}>
          {PHASE_TEXT[info.phase] || info.phase}
        </span>
        {info.userSide && (
          <span className="text-[11px] text-ui-muted">
            我方<b className={info.userSide === 'BLUE' ? 'text-sky-400' : 'text-rose-400'}>
              {info.userSide === 'BLUE' ? '蓝' : '红'}方
            </b>
          </span>
        )}
        {info.banCount > 0 && <span className="text-[10px] text-ui-muted">· {info.banCount} ban</span>}

        <span className="ml-auto flex items-center gap-1">
          <button
            onClick={fetchFrame}
            disabled={busy || !info.device}
            className="p-1 rounded-md text-ui-muted hover:text-ui-text hover:bg-white/10 disabled:opacity-30"
            title="刷新画面"
          >
            <RefreshCw className={cn('w-3 h-3', busy && 'animate-spin')} />
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="p-1 rounded-md text-ui-muted hover:text-ui-text hover:bg-white/10"
            title={collapsed ? '展开' : '收起'}
          >
            {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>
        </span>
      </div>

      {/* 画面 */}
      {!collapsed && (
        <div className="p-2">
          {image ? (
            <img
              src={image}
              alt="ADB live"
              className="w-full rounded-lg border border-white/8"
              style={{ maxHeight: 170, objectFit: 'contain', background: '#000' }}
            />
          ) : (
            <div className="h-[130px] flex flex-col items-center justify-center text-[11px] text-ui-muted/60 gap-1">
              <Camera className="w-5 h-5" />
              {info.device ? '点击右上角刷新获取画面' : '未选择设备（顶部或设备配置）'}
            </div>
          )}
          {size && (
            <p className="mt-1 text-[9px] text-ui-muted/60 text-right">
              {size.w}×{size.h}
              {info.monitoring ? ' · 实时' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
