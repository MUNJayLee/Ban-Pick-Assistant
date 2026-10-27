import { useEffect, useState } from 'react';
import { Play, Square, Smartphone, RefreshCw, ScanLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { useBpSync } from '@/hooks/useBpSync';

type AdbApi = ReturnType<typeof useBpSync>;

const PHASE_LABEL: Record<string, string> = {
  ban: '禁用中',
  pick: '选将中',
  final: 'BP 完成',
  other: '待机',
};

interface Props {
  adb: AdbApi;
}

/**
 * 顶部 ADB 实时识别状态条。
 *
 * 识别结果通过 useBpSync 直接写入 bpStore，因此这里的 ban/pick
 * 位会和下方 BpStage 自动同步，无需任何「导入」动作。
 */
export function AdbStatusBar({ adb }: Props) {
  const { info, devices, refreshDevices, selectDevice, startMonitoring, stopMonitoring, manualRecognize } = adb;
  const [refreshing, setRefreshing] = useState(false);

  // 首次挂载时拉一次设备列表
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshDevices();
    setRefreshing(false);
  };

  const handleToggle = async () => {
    if (info.monitoring) {
      await stopMonitoring();
      return;
    }
    // 未选设备时自动挑真机（或第一个）
    if (!info.device && devices.length > 0) {
      const real = devices.find((d) => d.is_real) || devices[0];
      await selectDevice(real.serial);
    }
    await startMonitoring();
  };

  const [manualBusy, setManualBusy] = useState(false);
  const handleManual = async () => {
    setManualBusy(true);
    if (!info.device && devices.length > 0) {
      const real = devices.find((d) => d.is_real) || devices[0];
      await selectDevice(real.serial);
    }
    await manualRecognize();
    setManualBusy(false);
  };

  const connected = info.connected;
  const active = info.monitoring;

  return (
    <div className="flex items-center gap-2">
      {/* 状态灯 + 阶段 */}
      <div
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-colors',
          !connected
            ? 'border-white/10 bg-white/5 text-ui-muted'
            : active
              ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-300'
              : 'border-ui-primary/30 bg-ui-primary/10 text-ui-primary-light',
        )}
        title={
          !connected
            ? 'API 服务未连接（请运行 启动v3.0.bat）'
            : active
              ? '正在监听 ADB 画面并识别 BP'
              : '已连接 API，点击右侧按钮开始识别'
        }
      >
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            !connected ? 'bg-ui-muted/50' : active ? 'bg-emerald-400 animate-pulse' : 'bg-ui-primary',
          )}
        />
        <span>{!connected ? 'ADB 离线' : active ? `ADB · ${PHASE_LABEL[info.phase] || '识别中'}` : 'ADB 就绪'}</span>
        {active && info.banCount > 0 && (
          <span className="text-[10px] opacity-70">· {info.banCount} ban</span>
        )}
      </div>

      {/* 设备选择 */}
      {devices.length > 0 && (
        <div className="hidden md:flex items-center gap-1 px-1.5 py-1 rounded-xl border border-white/10 bg-white/5">
          <Smartphone className="w-3 h-3 text-ui-muted" />
          <select
            value={info.device || ''}
            onChange={(e) => selectDevice(e.target.value)}
            className="bg-transparent text-[11px] text-ui-text outline-none max-w-[130px] cursor-pointer"
          >
            {!info.device && <option value="">选择设备</option>}
            {devices.map((d) => (
              <option key={d.serial} value={d.serial} className="bg-ui-surface text-ui-text">
                {d.is_real ? '📱 ' : '🖥 '}
                {d.serial}
              </option>
            ))}
          </select>
          <button
            onClick={handleRefresh}
            className="p-0.5 text-ui-muted hover:text-ui-text transition-colors"
            title="刷新设备列表"
          >
            <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} />
          </button>
        </div>
      )}

      {/* 手动识别一次 */}
      <button
        onClick={handleManual}
        disabled={!connected || manualBusy}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
          !connected
            ? 'border-white/10 text-ui-muted/60 cursor-not-allowed'
            : 'border-white/15 bg-white/5 text-ui-text hover:bg-white/10',
        )}
        title="手动抓帧识别一次（不进常驻监听）"
      >
        <ScanLine className={cn('w-3 h-3', manualBusy && 'animate-pulse')} />
        手动识别
      </button>

      {/* 开关 */}
      <button
        onClick={handleToggle}
        disabled={!connected}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
          !connected
            ? 'border-white/10 text-ui-muted/60 cursor-not-allowed'
            : active
              ? 'border-ui-danger/40 bg-ui-danger/10 text-ui-danger-light hover:bg-ui-danger/20'
              : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
        )}
        title={active ? '停止 ADB 识别' : '开始 ADB 实时识别'}
      >
        {active ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
        {active ? '停止识别' : '开始识别'}
      </button>

      {info.error && (
        <span className="text-[10px] text-ui-danger max-w-[160px] truncate" title={info.error}>
          {info.error}
        </span>
      )}
    </div>
  );
}
