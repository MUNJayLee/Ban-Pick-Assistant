import { useEffect, useState } from 'react';
import { Play, Square, RefreshCw, ScanLine, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { useBpSync } from '@/hooks/useBpSync';

type AdbApi = ReturnType<typeof useBpSync>;

const PHASE_TEXT: Record<string, string> = {
  ban: '禁用',
  pick: '选将',
  final: '已完成',
  other: '待机',
};

interface Props {
  adb: AdbApi;
  onOpenConfig: () => void;
}

/**
 * 左栏 ADB 控制面板（垂直布局）。
 * 设备选择 / 手动识别 / 开始停止 / 设备配置 / 状态信息全部收在这里，
 * 顶部导航只保留标题和 Tab。
 */
export function AdbControlPanel({ adb, onOpenConfig }: Props) {
  const { info, devices, refreshDevices, selectDevice, startMonitoring, stopMonitoring, manualRecognize } = adb;
  const [refreshing, setRefreshing] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);

  // 首次挂载拉一次设备列表
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshDevices();
    setRefreshing(false);
  };

  const ensureDevice = async (): Promise<string | null> => {
    if (info.device) return info.device;
    if (devices.length === 0) return null;
    const real = devices.find((d) => d.is_real) || devices[0];
    await selectDevice(real.serial);
    return real.serial;
  };

  const handleManual = async () => {
    if (!(await ensureDevice())) return;
    setManualBusy(true);
    await manualRecognize();
    setManualBusy(false);
  };

  const handleToggle = async () => {
    if (info.monitoring) {
      await stopMonitoring();
      return;
    }
    if (!(await ensureDevice())) return;
    await startMonitoring();
  };

  const connected = info.connected;
  const active = info.monitoring;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-ui-muted">ADB 控制</h3>
        <span
          className={cn(
            'flex items-center gap-1 text-[10px] font-semibold',
            !connected ? 'text-ui-muted' : active ? 'text-emerald-400' : 'text-ui-primary',
          )}
        >
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              !connected ? 'bg-ui-muted/50' : active ? 'bg-emerald-400 animate-pulse' : 'bg-ui-primary',
            )}
          />
          {!connected ? '离线' : active ? '监听中' : '就绪'}
        </span>
      </div>

      {/* 设备选择 */}
      <div>
        <label className="text-[10px] text-ui-muted/80">设备</label>
        <div className="flex items-center gap-1 mt-1">
          <select
            value={info.device || ''}
            onChange={(e) => selectDevice(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] text-ui-text outline-none cursor-pointer"
          >
            {!info.device && <option value="">选择设备</option>}
            {devices.length === 0 && <option value="">无可用设备</option>}
            {devices.map((d) => (
              <option key={d.serial} value={d.serial} className="bg-ui-surface text-ui-text">
                {d.is_real ? '📱 ' : '🖥 '}
                {d.serial}
              </option>
            ))}
          </select>
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-ui-muted hover:text-ui-text transition-colors"
            title="刷新设备"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={handleManual}
          disabled={!connected || manualBusy}
          className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] font-semibold text-ui-text hover:bg-white/10 disabled:opacity-40 transition-colors"
          title="手动抓帧识别一次"
        >
          <ScanLine className={cn('w-3 h-3', manualBusy && 'animate-pulse')} />
          手动识别
        </button>
        <button
          onClick={handleToggle}
          disabled={!connected}
          className={cn(
            'flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-40',
            active
              ? 'border-ui-danger/40 bg-ui-danger/10 text-ui-danger-light hover:bg-ui-danger/20'
              : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
          )}
        >
          {active ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {active ? '停止' : '开始识别'}
        </button>
      </div>

      <button
        onClick={onOpenConfig}
        className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] font-semibold text-ui-muted hover:text-ui-text hover:bg-white/10 transition-colors"
      >
        <Settings className="w-3 h-3" />
        设备配置
      </button>

      {/* 识别状态 */}
      <div className="pt-2 border-t border-white/8 space-y-1 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-ui-muted">阶段</span>
          <span className="text-ui-text">{PHASE_TEXT[info.phase] || info.phase}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ui-muted">我方阵营</span>
          <span
            className={cn(
              info.userSide === 'BLUE' ? 'text-sky-400' : info.userSide === 'RED' ? 'text-rose-400' : 'text-ui-muted',
            )}
          >
            {info.userSide === 'BLUE' ? '蓝方' : info.userSide === 'RED' ? '红方' : '未识别'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ui-muted">已识别 ban</span>
          <span className="text-ui-text">{info.banCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ui-muted">已识别 pick</span>
          <span className="text-ui-text">{info.pickCount}</span>
        </div>
      </div>

      {info.error && (
        <p className="text-[10px] text-ui-danger bg-ui-danger/10 border border-ui-danger/25 rounded-lg px-2 py-1 truncate" title={info.error}>
          {info.error}
        </p>
      )}
    </div>
  );
}
