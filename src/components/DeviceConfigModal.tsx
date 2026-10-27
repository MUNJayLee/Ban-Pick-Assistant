import { useCallback, useEffect, useState } from 'react';
import { X, RefreshCw, Smartphone, Camera, Database, Play, Square, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { useBpSync } from '@/hooks/useBpSync';

type AdbApi = ReturnType<typeof useBpSync>;

const API = 'http://127.0.0.1:8900';

interface Props {
  open: boolean;
  onClose: () => void;
  adb: AdbApi;
}

/** 设备配置弹窗：ADB 接入调试参数（设备/抓帧/数据同步/日志）。 */
export function DeviceConfigModal({ open, onClose, adb }: Props) {
  const { info, devices, refreshDevices, selectDevice, startMonitoring, stopMonitoring } = adb;
  const [refreshing, setRefreshing] = useState(false);
  const [capture, setCapture] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [heroCount, setHeroCount] = useState<number | null>(null);

  const log = useCallback((m: string) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} ${m}`, ...prev].slice(0, 60));
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshDevices();
    fetch(`${API}/api/heroes`)
      .then((r) => r.json())
      .then((r) => {
        if (r.ok) setHeroCount(r.count);
      })
      .catch(() => undefined);
  }, [open, refreshDevices]);

  const handleRefresh = async () => {
    setRefreshing(true);
    const list = await refreshDevices();
    setRefreshing(false);
    log(`设备 ${list.length} 个`);
  };

  const handleCapture = async () => {
    setCapturing(true);
    try {
      const r = await fetch(`${API}/api/capture`, { method: 'POST' }).then((x) => x.json());
      if (r.ok) {
        setCapture(r.image);
        log(`抓帧成功 ${r.width}x${r.height}`);
      } else {
        log('抓帧失败');
      }
    } catch (e) {
      log(`抓帧异常: ${e instanceof Error ? e.message : e}`);
    } finally {
      setCapturing(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    log('开始同步英雄数据...');
    try {
      const r = await fetch(`${API}/api/data/sync`, { method: 'POST' }).then((x) => x.json());
      log(r.ok ? '英雄数据同步完成' : `同步失败: ${r.error || ''}`);
      const h = await fetch(`${API}/api/heroes`).then((x) => x.json());
      if (h.ok) setHeroCount(h.count);
    } catch (e) {
      log(`同步异常: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSyncing(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b1018] shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/8 sticky top-0 bg-[#0b1018] z-10">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-ui-primary" />
            <h2 className="text-sm font-semibold text-white">设备配置</h2>
            <span className="text-[10px] text-ui-muted">ADB 接入与调试</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-ui-muted hover:text-white hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 状态 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border',
                info.connected
                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-ui-muted',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', info.connected ? 'bg-emerald-400' : 'bg-ui-muted/50')} />
              {info.connected ? 'API 已连接' : 'API 未连接'}
            </span>
            <span className="text-xs text-ui-muted">
              阶段: <b className="text-ui-text">{info.phase}</b>
            </span>
            <span className="text-xs text-ui-muted">
              我方阵营: <b className="text-ui-text">{info.userSide || '未识别'}</b>
            </span>
            {heroCount !== null && <span className="text-xs text-ui-muted">英雄库: {heroCount}</span>}
          </div>

          {/* 设备列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-ui-muted">设备列表</h3>
              <button
                onClick={handleRefresh}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-ui-primary hover:bg-ui-primary/10"
              >
                <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} />
                刷新
              </button>
            </div>
            <div className="space-y-1.5">
              {devices.length === 0 && (
                <p className="text-xs text-ui-muted">未检测到设备（连接手机并开启 USB 调试）</p>
              )}
              {devices.map((d) => (
                <button
                  key={d.serial}
                  onClick={() => selectDevice(d.serial)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs border transition-colors text-left',
                    info.device === d.serial
                      ? 'border-ui-primary bg-ui-primary/10 text-ui-primary'
                      : 'border-white/10 hover:border-white/25 text-ui-text',
                  )}
                >
                  <span>{d.is_real ? '📱' : '🖥'}</span>
                  <span className="font-mono">{d.serial}</span>
                  <span className="ml-auto text-[10px] opacity-60">
                    {d.is_real ? '真机' : '模拟器'} · {d.state}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 操作 */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleCapture}
              disabled={capturing || !info.device}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 text-xs hover:bg-white/15 disabled:opacity-40"
            >
              <Camera className={cn('w-3.5 h-3.5', capturing && 'animate-pulse')} />
              抓帧测试
            </button>
            <button
              onClick={info.monitoring ? stopMonitoring : startMonitoring}
              disabled={!info.device}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs disabled:opacity-40',
                info.monitoring
                  ? 'bg-ui-danger/15 text-ui-danger-light hover:bg-ui-danger/25'
                  : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25',
              )}
            >
              {info.monitoring ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {info.monitoring ? '停止识别' : '开始识别'}
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 text-xs hover:bg-white/15 disabled:opacity-40"
            >
              <Database className={cn('w-3.5 h-3.5', syncing && 'animate-pulse')} />
              同步英雄数据
            </button>
          </div>

          {/* 抓帧预览 */}
          {capture && (
            <div>
              <h3 className="text-xs font-semibold text-ui-muted mb-2">抓帧预览</h3>
              <img src={capture} alt="capture" className="w-full rounded-lg border border-white/10" />
            </div>
          )}

          {/* 日志 */}
          <div>
            <h3 className="text-xs font-semibold text-ui-muted mb-2 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              调试日志
            </h3>
            <div className="h-32 overflow-y-auto rounded-lg bg-black/40 border border-white/8 p-2 font-mono text-[10px] text-ui-muted space-y-0.5">
              {logs.length === 0 && <p className="opacity-50">（暂无）</p>}
              {logs.map((l, i) => (
                <p key={i} className="truncate">
                  {l}
                </p>
              ))}
            </div>
          </div>

          {info.error && (
            <p className="text-xs text-ui-danger bg-ui-danger/10 border border-ui-danger/25 rounded-lg px-3 py-2">
              错误: {info.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
