import { useCallback, useEffect, useRef, useState } from 'react';
import { useBpStore } from '@/store/bpStore';
import type { Side } from '@/types';

const API = 'http://127.0.0.1:8900';

export interface BpSyncDevice {
  serial: string;
  state: string;
  is_real: boolean;
}

export interface BpSyncInfo {
  connected: boolean;
  device: string | null;
  phase: 'ban' | 'pick' | 'final' | 'other';
  phaseScore: number;
  userSide: Side | null;
  banCount: number;
  monitoring: boolean;
  error: string | null;
}

interface RawState {
  device: string | null;
  phase: 'ban' | 'pick' | 'final' | 'other';
  phase_score: number;
  bans: Array<{ side: 'blue' | 'red'; index: number; hero_id: string; confident: boolean }>;
  user_side: 'BLUE' | 'RED' | null;
  monitoring: boolean;
  error: string | null;
}

/**
 * ADB 识别结果 → bpStore 自动同步。
 *
 * 链路：
 *   Python API (:8900) --WebSocket--> 本 hook --> bpStore
 *   -- 阵营变化 → setUserSide
 *   -- ban 变化 → setBanAt 增量更新（不重置 pick）
 *   -- 新一局（bans 清空）→ reset
 */
export function useBpSync() {
  const [info, setInfo] = useState<BpSyncInfo>({
    connected: false,
    device: null,
    phase: 'other',
    phaseScore: 0,
    userSide: null,
    banCount: 0,
    monitoring: false,
    error: null,
  });
  const [devices, setDevices] = useState<BpSyncDevice[]>([]);

  // 上一次的 ban 指纹，用于去重
  const lastBanKey = useRef<string>('');
  const lastSide = useRef<Side | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const applyState = useCallback((raw: RawState) => {
    const store = useBpStore.getState();

    // ① 阵营（我方蓝/红）
    if (raw.user_side && raw.user_side !== lastSide.current) {
      lastSide.current = raw.user_side;
      if (store.userSide !== raw.user_side) {
        store.setUserSide(raw.user_side);
      }
    }

    // ② 新一局检测：bans 清空且之前有数据 → 重置
    if (!raw.bans || raw.bans.length === 0) {
      if (lastBanKey.current !== '') {
        lastBanKey.current = '';
        store.reset();
      }
    } else {
      // ③ 增量写入 ban 位（只写有变化的，避免覆盖手动 pick）
      const key = raw.bans
        .map((b) => `${b.side}${b.index}:${b.hero_id}`)
        .sort()
        .join('|');
      if (key !== lastBanKey.current) {
        lastBanKey.current = key;
        for (const b of raw.bans) {
          const side: Side = b.side === 'blue' ? 'BLUE' : 'RED';
          // API 的 index 是 1-based，store 是 0-based
          const idx = Math.max(0, b.index - 1);
          // 已有值且与识别结果不同 -> 视为用户手动修改，保留不覆盖
          const arr = side === 'BLUE' ? store.blueBans : store.redBans;
          if (arr[idx] && arr[idx] !== b.hero_id) continue;
          store.setBanAt(side, idx, b.hero_id);
        }
      }
    }

    setInfo({
      connected: true,
      device: raw.device,
      phase: raw.phase,
      phaseScore: raw.phase_score,
      userSide: raw.user_side,
      banCount: raw.bans?.length ?? 0,
      monitoring: raw.monitoring,
      error: raw.error,
    });
  }, []);

  // ---------- WebSocket 连接（自动重连）----------
  useEffect(() => {
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
      ws.onopen = () => setInfo((s) => ({ ...s, connected: true }));
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'state' && msg.data) applyState(msg.data as RawState);
        } catch {
          /* ignore */
        }
      };
      ws.onerror = () => {
        /* 由 onclose 重连 */
      };
      ws.onclose = () => {
        setInfo((s) => ({ ...s, connected: false }));
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
  }, [applyState]);

  // ---------- 设备 / 控制 ----------
  const refreshDevices = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/devices`).then((x) => x.json());
      setDevices(r.devices || []);
      return r.devices as BpSyncDevice[];
    } catch {
      setDevices([]);
      return [];
    }
  }, []);

  const selectDevice = useCallback(async (serial: string) => {
    try {
      await fetch(`${API}/api/device/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial }),
      });
      setInfo((s) => ({ ...s, device: serial }));
    } catch {
      /* ignore */
    }
  }, []);

  const startMonitoring = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/bp/start`, { method: 'POST' }).then((x) => x.json());
      if (!r.ok) throw new Error(r.detail || '启动失败');
      setInfo((s) => ({ ...s, monitoring: true, error: null }));
    } catch (e) {
      setInfo((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  const manualRecognize = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/recognize/once`, { method: 'POST' }).then((x) => x.json());
      if (!r.ok) throw new Error(r.detail || '识别失败');
      return r as { phase: string; user_side: 'BLUE' | 'RED' | null; ban_count: number };
    } catch (e) {
      setInfo((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
      return null;
    }
  }, []);

  const stopMonitoring = useCallback(async () => {
    try {
      await fetch(`${API}/api/bp/stop`, { method: 'POST' });
      setInfo((s) => ({ ...s, monitoring: false }));
    } catch {
      /* ignore */
    }
  }, []);

  return {
    info,
    devices,
    refreshDevices,
    selectDevice,
    startMonitoring,
    stopMonitoring,
    manualRecognize,
  };
}
