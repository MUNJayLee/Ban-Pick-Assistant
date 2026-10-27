import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { recommendHeroes } from '@/services/recommendation';
import { getHeroById } from '@/services/heroService';
import type { BpState, Side } from '@/types';

const API = 'http://127.0.0.1:8900';

interface Device {
  serial: string;
  state: string;
  is_real: boolean;
}

interface BanItem {
  side: 'blue' | 'red';
  index: number;
  hero_id: string;
  name: string;
  score: number;
  gap: number;
  confident: boolean;
}

interface ApiState {
  device: string | null;
  phase: 'ban' | 'pick' | 'final' | 'other';
  phase_score: number;
  bans: BanItem[];
  monitoring: boolean;
  last_update: string | null;
  error: string | null;
}

const PHASE_LABEL: Record<string, { text: string; color: string }> = {
  ban: { text: '禁用阶段', color: 'text-rose-400' },
  pick: { text: '选将阶段', color: 'text-sky-400' },
  final: { text: 'BP 完成（最后调整）', color: 'text-emerald-400' },
  other: { text: '非 BP 界面', color: 'text-ui-muted' },
};

export function Console() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [device, setDevice] = useState<string>('');
  const [state, setState] = useState<ApiState | null>(null);
  const [capture, setCapture] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [side, setSide] = useState<Side>('BLUE');
  const [busy, setBusy] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const log = useCallback((msg: string) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} ${msg}`, ...prev].slice(0, 80));
  }, []);

  // ---------- API 工具 ----------
  const api = useCallback(async (path: string, method = 'GET') => {
    const res = await fetch(`${API}${path}`, { method });
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return res.json();
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const r = await api('/api/devices');
      setDevices(r.devices || []);
      if (!device && r.devices?.length) {
        const real = r.devices.find((d: Device) => d.is_real) || r.devices[0];
        setDevice(real.serial);
        await fetch(`${API}/api/device/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial: real.serial }),
        }).catch(() => undefined);
        log(`发现设备 ${r.devices.length} 个`);
      }
    } catch (e) {
      log(`设备列表失败: ${e instanceof Error ? e.message : e}`);
    }
  }, [api, device, log]);

  const selectDevice = useCallback(
    async (serial: string) => {
      try {
        await fetch(`${API}/api/device/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial }),
        });
        setDevice(serial);
        log(`已选择设备 ${serial}`);
      } catch (e) {
        log(`选择设备失败: ${e}`);
      }
    },
    [log],
  );

  const doCapture = useCallback(async () => {
    setCapturing(true);
    try {
      const r = await fetch(`${API}/api/capture`, { method: 'POST' }).then((x) => x.json());
      if (r.ok) {
        setCapture(r.image);
        log(`抓帧成功 ${r.width}x${r.height}`);
      } else log('抓帧失败');
    } catch (e) {
      log(`抓帧失败: ${e}`);
    } finally {
      setCapturing(false);
    }
  }, [log]);

  const toggleMonitor = useCallback(
    async (start: boolean) => {
      setBusy(start ? 'start' : 'stop');
      try {
        await fetch(`${API}/api/bp/${start ? 'start' : 'stop'}`, { method: 'POST' });
        log(start ? 'BP 监听已启动' : 'BP 监听已停止');
      } catch (e) {
        log(`操作失败: ${e}`);
      } finally {
        setBusy('');
      }
    },
    [log],
  );

  const syncData = useCallback(async () => {
    setBusy('sync');
    try {
      const r = await fetch(`${API}/api/data/sync`, { method: 'POST' }).then((x) => x.json());
      log(r.ok ? '英雄数据同步完成' : `同步失败: ${r.error || ''}`);
    } catch (e) {
      log(`同步失败: ${e}`);
    } finally {
      setBusy('');
    }
  }, [log]);

  // ---------- 初始化 ----------
  useEffect(() => {
    refreshDevices();

    // WebSocket 自动重连（兼容 React StrictMode 双挂载）
    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(`${API.replace('http', 'ws')}/ws`);
      } catch {
        return;
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'state') setState(msg.data);
        } catch {
          /* ignore */
        }
      };
      ws.onerror = () => {
        /* 静默：由 onclose 负责重连 */
      };
      ws.onclose = () => {
        if (!closed) retryTimer = setTimeout(connect, 2000);
      };
      wsRef.current = ws;
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
      wsRef.current = null;
    };
  }, [refreshDevices, log]);

  // ---------- 推荐 ----------
  const recommendations = useMemo(() => {
    if (!state) return [];
    try {
      const bp: BpState = {
        userSide: side,
        blueBans: state.bans.filter((b) => b.side === 'blue').map((b) => b.hero_id),
        redBans: state.bans.filter((b) => b.side === 'red').map((b) => b.hero_id),
        bluePicks: [],
        redPicks: [],
        phase: 'PICK',
        pickTurnIndex: 0,
      };
      return recommendHeroes(bp, side, 'PICK').slice(0, 6);
    } catch {
      return [];
    }
  }, [state, side]);

  const phaseInfo = PHASE_LABEL[state?.phase || 'other'];

  return (
    <div className="min-h-screen bg-[#080c14] text-ui-text p-4">
      <div className="max-w-6xl mx-auto">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold">王者BP助手 v3.0</h1>
            <p className="text-xs text-ui-muted mt-1">ADB 接入 · 实时 BP 识别 · 智能推荐</p>
          </div>
          <a href="/" className="text-xs text-ui-primary hover:underline">
            返回手动 BP 界面 →
          </a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 左列：设备接入 */}
          <div className="lg:col-span-1 space-y-4">
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <span>📱</span> 设备接入
              </h2>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={refreshDevices}
                  className="px-3 py-1.5 rounded-lg bg-ui-primary/20 text-ui-primary text-xs hover:bg-ui-primary/30"
                >
                  刷新设备
                </button>
              </div>
              <div className="space-y-2">
                {devices.length === 0 && (
                  <p className="text-xs text-ui-muted">未检测到设备（请连手机并开 USB 调试）</p>
                )}
                {devices.map((d) => (
                  <button
                    key={d.serial}
                    onClick={() => selectDevice(d.serial)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition ${
                      device === d.serial
                        ? 'border-ui-primary bg-ui-primary/10 text-ui-primary'
                        : 'border-white/10 hover:border-white/20 text-ui-text'
                    }`}
                  >
                    <span className="font-mono">{d.serial}</span>
                    <span className="ml-2 text-[10px] opacity-70">
                      {d.is_real ? '真机' : '模拟器'} · {d.state}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={doCapture}
                  disabled={capturing || !device}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-white/10 text-xs hover:bg-white/15 disabled:opacity-40"
                >
                  {capturing ? '抓帧中…' : '抓帧预览'}
                </button>
              </div>
              {capture && (
                <img
                  src={capture}
                  alt="capture"
                  className="mt-3 w-full rounded-lg border border-white/10"
                />
              )}
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <span>🎮</span> 识别控制
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleMonitor(true)}
                  disabled={!device || state?.monitoring || busy !== ''}
                  className="flex-1 px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs hover:bg-emerald-500/30 disabled:opacity-40"
                >
                  {busy === 'start' ? '启动中…' : '开始监听'}
                </button>
                <button
                  onClick={() => toggleMonitor(false)}
                  disabled={!state?.monitoring || busy !== ''}
                  className="flex-1 px-3 py-2 rounded-lg bg-rose-500/20 text-rose-300 text-xs hover:bg-rose-500/30 disabled:opacity-40"
                >
                  停止
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setSide('BLUE')}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs ${
                    side === 'BLUE' ? 'bg-sky-500/30 text-sky-200' : 'bg-white/5 text-ui-muted'
                  }`}
                >
                  我方蓝方
                </button>
                <button
                  onClick={() => setSide('RED')}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs ${
                    side === 'RED' ? 'bg-rose-500/30 text-rose-200' : 'bg-white/5 text-ui-muted'
                  }`}
                >
                  我方红方
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <span>🔄</span> 英雄数据
              </h2>
              <button
                onClick={syncData}
                disabled={busy !== ''}
                className="w-full px-3 py-2 rounded-lg bg-white/10 text-xs hover:bg-white/15 disabled:opacity-40"
              >
                {busy === 'sync' ? '同步中…' : '同步英雄数据（天元之弈）'}
              </button>
              <p className="text-[10px] text-ui-muted mt-2">
                检测新英雄并补全头像/梯度/克制数据
              </p>
            </section>
          </div>

          {/* 右列：BP 状态 */}
          <div className="lg:col-span-2 space-y-4">
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <span>🎯</span> BP 实时状态
                </h2>
                <span className={`text-xs ${phaseInfo.color}`}>
                  {state?.monitoring ? '● 监听中' : '○ 未监听'} · {phaseInfo.text}
                </span>
              </div>

              {state?.error && (
                <p className="text-xs text-rose-400 mb-2">错误: {state.error}</p>
              )}

              {/* ban 列表 */}
              <div className="space-y-3">
                {(['blue', 'red'] as const).map((s) => {
                  const items = (state?.bans || []).filter((b) => b.side === s);
                  return (
                    <div key={s}>
                      <p className="text-[11px] text-ui-muted mb-1">
                        {s === 'blue' ? '蓝方 ban' : '红方 ban'}（{items.length}）
                      </p>
                      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                        {items.length === 0 && (
                          <span className="text-[11px] text-ui-muted/60">（空）</span>
                        )}
                        {items.map((b) => {
                          const hero = getHeroById(b.hero_id);
                          return (
                            <span
                              key={`${b.side}-${b.hero_id}`}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] ${
                                b.confident
                                  ? 'bg-white/10 text-ui-text'
                                  : 'bg-amber-500/15 text-amber-300'
                              }`}
                            >
                              {hero?.name || b.name}
                              {!b.confident && <span className="opacity-60">?</span>}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 推荐 */}
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <span>💡</span> 推荐（我方{side === 'BLUE' ? '蓝' : '红'}方）
              </h2>
              {recommendations.length === 0 ? (
                <p className="text-xs text-ui-muted">
                  等待 ban 数据…（识别到 ban 后自动推荐）
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {recommendations.map((rec, i) => {
                    const hero = getHeroById(rec.heroId);
                    return (
                      <div
                        key={rec.heroId}
                        className="flex items-center gap-2 px-2 py-2 rounded-lg bg-white/5 border border-white/10"
                      >
                        <span className="text-[10px] text-ui-muted w-4">{i + 1}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">
                            {hero?.name || rec.heroId}
                          </p>
                          <p className="text-[10px] text-ui-muted truncate">
                            {hero?.positionLabel || hero?.roles?.[0] || ''}
                          </p>
                        </div>
                        <span className="ml-auto text-[10px] text-ui-primary">
                          {Math.round(rec.score)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 日志 */}
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h2 className="text-sm font-semibold mb-2">运行日志</h2>
              <div className="h-32 overflow-y-auto font-mono text-[10px] text-ui-muted space-y-0.5">
                {logs.length === 0 && <p>（暂无）</p>}
                {logs.map((l, i) => (
                  <p key={i} className="truncate">
                    {l}
                  </p>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
