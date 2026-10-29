import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  X,
  RefreshCw,
  ImageIcon,
  ChevronLeft,
  ChevronDown,
  AlertTriangle,
  Maximize2,
  CheckCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FrameThumb } from '@/components/FrameThumb';

const API = 'http://127.0.0.1:8900';
const SLOTS_PER_SIDE = 5;
const DONE_MARK_COUNT = 10; // 5 蓝 + 5 红

const FILTERS = ['ban', 'pick', 'selecting', 'other', 'all'] as const;
type FrameFilter = (typeof FILTERS)[number];

interface FrameInfo {
  name: string;
  kind: string;
  mtime: string;
  size: number;
}

interface CropData {
  image: string;
  hero: string | null;
  confident: boolean | null;
  gap: number | null;
  lane_icon?: boolean;
  side: string;
  index: number;
  kind: string;
}

interface Mark {
  correct: boolean;
  note: string;
}

interface FrameProgress {
  marked: number;
  correct: number;
  wrong: number;
  done: boolean;
}

const SIDES: Array<'blue' | 'red'> = ['blue', 'red'];

function kindBadgeClass(kind: string): string {
  if (kind === 'ban') return 'bg-ui-warning/20 text-ui-warning';
  if (kind === 'selecting') return 'bg-ui-purple/20 text-ui-purple';
  if (kind === 'pick') return 'bg-ui-accent/20 text-ui-accent';
  return 'bg-ui-surface-elevated text-ui-muted';
}

export function ReviewPanel() {
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [filter, setFilter] = useState<FrameFilter>(() => {
    try {
      const saved = localStorage.getItem('review-filter');
      if (saved && (FILTERS as readonly string[]).includes(saved)) return saved as FrameFilter;
    } catch {
      /* ignore */
    }
    return 'ban';
  });
  const [showDone, setShowDone] = useState<boolean>(() => {
    try {
      return localStorage.getItem('review-show-done') === '1';
    } catch {
      return false;
    }
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [selected, setSelected] = useState<FrameInfo | null>(null);
  const [mode, setMode] = useState<'ban' | 'pick'>('ban');
  const [crops, setCrops] = useState<Record<string, CropData>>({});
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [summary, setSummary] = useState<{ total: number; marked: number; done: number; totalMarks: number }>({
    total: 0,
    marked: 0,
    done: 0,
    totalMarks: 0,
  });
  const [framesLoading, setFramesLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // ---------- 加载帧列表 ----------
  const loadFrames = useCallback(async () => {
    setFramesLoading(true);
    try {
      const r = await fetch(`${API}/api/review/frames?limit=100`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setFrames(Array.isArray(d.frames) ? d.frames : []);
      setError(null);
    } catch {
      setError('无法连接 API（8900），请确认服务已启动');
    } finally {
      setFramesLoading(false);
    }
  }, []);

  // ---------- 加载标注 ----------
  const loadMarks = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/review/marks`);
      if (!r.ok) return;
      const d = await r.json();
      const m = d.marks || {};
      const out: Record<string, Mark> = {};
      for (const [k, v] of Object.entries(m)) {
        const vv = v as { correct: boolean; note?: string };
        out[k] = { correct: vv.correct, note: vv.note || '' };
      }
      setMarks(out);
    } catch {
      /* ignore */
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/review/summary`);
      if (!r.ok) return;
      const d = await r.json();
      setSummary({
        total: d.total_frames || 0,
        marked: d.marked_frames || 0,
        done: d.done_frames || 0,
        totalMarks: d.total_marks || 0,
      });
    } catch {
      /* ignore */
    }
  }, []);

  const reloadAll = useCallback(() => {
    void loadFrames();
    void loadMarks();
    void loadSummary();
  }, [loadFrames, loadMarks, loadSummary]);

  useEffect(() => {
    void loadFrames();
    void loadMarks();
    void loadSummary();
  }, [loadFrames, loadMarks, loadSummary]);

  // ---------- 加载当前帧的裁切 ----------
  const loadCrops = useCallback(async (frame: FrameInfo, m: 'ban' | 'pick') => {
    setLoading(true);
    setError(null);
    const next: Record<string, CropData> = {};
    try {
      const tasks: Array<Promise<void>> = [];
      for (const side of SIDES) {
        for (let i = 1; i <= SLOTS_PER_SIDE; i++) {
          tasks.push(
            (async () => {
              try {
                const r = await fetch(
                  `${API}/api/review/crop?frame=${encodeURIComponent(frame.name)}&kind=${m}&side=${side}&index=${i}`,
                );
                if (!r.ok) return;
                const d = await r.json();
                next[`${side}${i}`] = d;
              } catch {
                /* 单个位置失败不影响整体 */
              }
            })(),
          );
        }
      }
      await Promise.all(tasks);
      setCrops(next);
    } catch {
      setError('裁切加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // filter / 折叠状态持久化
  useEffect(() => {
    try {
      localStorage.setItem('review-filter', filter);
    } catch {
      /* ignore */
    }
  }, [filter]);

  useEffect(() => {
    try {
      localStorage.setItem('review-show-done', showDone ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [showDone]);

  // ---------- 每帧标注进度（按 frame|kind 统计，取标注多的模式） ----------
  const frameProgress = useMemo(() => {
    const perKind = new Map<string, { marked: number; correct: number; wrong: number }>();
    for (const [key, mark] of Object.entries(marks)) {
      const [frame, kind] = key.split('|');
      if (!frame || !kind) continue;
      const combo = `${frame}|${kind}`;
      const entry = perKind.get(combo) ?? { marked: 0, correct: 0, wrong: 0 };
      entry.marked += 1;
      if (mark.correct) entry.correct += 1;
      else entry.wrong += 1;
      perKind.set(combo, entry);
    }
    const perFrame = new Map<string, FrameProgress>();
    for (const [combo, entry] of perKind) {
      const frame = combo.slice(0, combo.indexOf('|'));
      const best = perFrame.get(frame);
      if (!best || entry.marked > best.marked) {
        perFrame.set(frame, {
          marked: entry.marked,
          correct: entry.correct,
          wrong: entry.wrong,
          done: entry.marked >= DONE_MARK_COUNT,
        });
      }
    }
    return perFrame;
  }, [marks]);

  const progressRef = useRef(frameProgress);
  useEffect(() => {
    progressRef.current = frameProgress;
  }, [frameProgress]);

  const isFrameDone = useCallback((name: string) => frameProgress.get(name)?.done ?? false, [frameProgress]);

  const filteredFrames = useMemo(
    () => (filter === 'all' ? frames : frames.filter((f) => f.kind === filter)),
    [frames, filter],
  );

  // ---------- 选帧 ----------
  const handleSelect = useCallback(
    (f: FrameInfo) => {
      setSelected(f);
      setDirty(false);
      // ban 帧默认看 ban；pick/selecting 帧默认看 pick
      const m: 'ban' | 'pick' = f.kind === 'ban' ? 'ban' : 'pick';
      setMode(m);
      // 已核对帧在折叠区里：选中时自动展开，避免左侧看不到高亮
      if (progressRef.current.get(f.name)?.done) setShowDone(true);
      void loadCrops(f, m);
    },
    [loadCrops],
  );

  // ---------- 标记 ----------
  const setMark = useCallback(
    async (slide: string, correct: boolean, note: string) => {
      if (!selected) return;
      const side = slide.startsWith('blue') ? 'blue' : 'red';
      const idx = Number(slide.replace(/\D/g, ''));
      const realKey = `${selected.name}|${mode}|${side}|${idx}`;
      setMarks((prev) => ({ ...prev, [realKey]: { correct, note } }));
      setDirty(true);
      try {
        await fetch(`${API}/api/review/mark`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frame: selected.name,
            kind: mode,
            side,
            index: idx,
            correct,
            note,
          }),
        });
        setDirty(false);
      } catch {
        setError('保存失败（API 可能断开）');
      }
    },
    [selected, mode],
  );

  // ---------- 批量标记（本帧全部正确 / 全部错误） ----------
  const bulkMark = useCallback(
    async (correct: boolean) => {
      if (!selected || bulkSaving) return;
      const frame = selected;
      const kind = mode;
      setBulkSaving(true);
      setDirty(true);
      setError(null);
      const next: Record<string, Mark> = {};
      try {
        const tasks: Array<Promise<Response>> = [];
        for (const side of SIDES) {
          for (let i = 1; i <= SLOTS_PER_SIDE; i++) {
            next[`${frame.name}|${kind}|${side}|${i}`] = { correct, note: '' };
            tasks.push(
              fetch(`${API}/api/review/mark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frame: frame.name, kind, side, index: i, correct, note: '' }),
              }),
            );
          }
        }
        const results = await Promise.all(tasks);
        if (results.some((r) => !r.ok)) throw new Error('部分标注保存失败');
        setMarks((prev) => ({ ...prev, ...next }));
        void loadSummary();

        // 全部正确后自动跳下一帧（跳过已核对帧），方便连续核对
        if (correct) {
          const currentIdx = filteredFrames.findIndex((f) => f.name === frame.name);
          const ordered = [...filteredFrames.slice(currentIdx + 1), ...filteredFrames.slice(0, currentIdx)];
          const nextFrame = ordered.find(
            (f) => f.name !== frame.name && !(progressRef.current.get(f.name)?.done ?? false),
          );
          if (nextFrame) window.setTimeout(() => handleSelect(nextFrame), 350);
        }
      } catch {
        setError('批量标记保存失败，请检查 API 连接');
      } finally {
        setBulkSaving(false);
        setDirty(false);
      }
    },
    [selected, mode, bulkSaving, filteredFrames, loadSummary, handleSelect],
  );

  const activeFrames = useMemo(() => filteredFrames.filter((f) => !isFrameDone(f.name)), [filteredFrames, isFrameDone]);
  const doneFrames = useMemo(() => filteredFrames.filter((f) => isFrameDone(f.name)), [filteredFrames, isFrameDone]);
  // 视觉顺序 = 待核对在前 + 已核对（展开时）在后，键盘切帧也按这个顺序
  const displayFrames = useMemo(
    () => (showDone ? [...activeFrames, ...doneFrames] : activeFrames),
    [activeFrames, doneFrames, showDone],
  );

  const goFrame = useCallback(
    (dir: 1 | -1) => {
      if (!displayFrames.length) return;
      const idx = selected ? displayFrames.findIndex((f) => f.name === selected.name) : -1;
      let next: FrameInfo | undefined;
      if (idx === -1) {
        next = dir === 1 ? displayFrames[0] : displayFrames[displayFrames.length - 1];
      } else {
        next = displayFrames[idx + dir];
      }
      if (next) handleSelect(next);
    },
    [displayFrames, selected, handleSelect],
  );

  // 自动选中第一个待核对帧（筛选变化 / 首次加载时）
  useEffect(() => {
    if (filteredFrames.length === 0) return;
    if (selected && filteredFrames.some((f) => f.name === selected.name)) return;
    const firstActive = filteredFrames.find((f) => !isFrameDone(f.name));
    handleSelect(firstActive ?? filteredFrames[0]);
  }, [filteredFrames, selected, isFrameDone, handleSelect]);

  // ---------- 当前帧统计 ----------
  const stats = useMemo(() => {
    if (!selected) return { marked: 0, correct: 0, wrong: 0 };
    const prefix = `${selected.name}|${mode}|`;
    let correct = 0;
    let wrong = 0;
    for (const [key, mark] of Object.entries(marks)) {
      if (!key.startsWith(prefix)) continue;
      if (mark.correct) correct += 1;
      else wrong += 1;
    }
    return { marked: correct + wrong, correct, wrong };
  }, [marks, selected, mode]);

  // 键盘快捷键：←/→ 切帧、1=全部正确、0=全部错误、Esc 关预览
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (e.key === 'Escape') {
        setPreview(null);
        return;
      }
      if (!selected) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goFrame(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goFrame(1);
      } else if (e.key === '1' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void bulkMark(true);
      } else if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void bulkMark(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, goFrame, bulkMark]);

  const exportMarks = useCallback((format: 'json' | 'csv') => {
    window.open(`${API}/api/review/export?format=${format}`, '_blank');
  }, []);

  const getMark = (side: string, index: number): Mark | undefined => {
    if (!selected) return undefined;
    return marks[`${selected.name}|${mode}|${side}|${index}`];
  };

  const openPreview = () => {
    if (!selected) return;
    setPreview(`${API}/api/review/frame_raw?frame=${encodeURIComponent(selected.name)}`);
  };

  // ---------- 帧列表项 ----------
  const renderFrameItem = (f: FrameInfo, dimmed = false) => {
    const progress = frameProgress.get(f.name);
    const isSelected = selected?.name === f.name;
    return (
      <button
        key={f.name}
        onClick={() => handleSelect(f)}
        className={cn(
          'mb-1 flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition',
          isSelected
            ? 'bg-ui-accent/15 text-ui-accent ring-1 ring-ui-accent/40'
            : 'text-ui-text hover:bg-white/5',
          dimmed && !isSelected && 'opacity-55 hover:opacity-90',
        )}
        title={f.name}
      >
        <FrameThumb frame={f.name} done={progress?.done} className="h-10 w-16" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span
              className={cn(
                'truncate text-[11px] font-medium',
                f.kind === 'ban' && !isSelected && 'text-ui-warning',
              )}
            >
              {f.name}
            </span>
            {progress?.marked ? (
              <span
                className={cn(
                  'ml-auto shrink-0 font-mono text-[10px]',
                  progress.done ? 'text-ui-success' : 'text-ui-muted',
                )}
              >
                {progress.done ? '✓' : `${progress.marked}/${DONE_MARK_COUNT}`}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ui-muted-subtle">
            <span className={cn('rounded px-1', kindBadgeClass(f.kind))}>{f.kind}</span>
            <span>{f.mtime}</span>
            <span className="ml-auto">{Math.round(f.size / 1024)}KB</span>
          </div>
        </div>
      </button>
    );
  };

  // ---------- 初始加载 / 无帧 ----------
  if (!frames.length) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-ui-muted">
        {framesLoading ? (
          <>
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span className="text-sm">加载素材...</span>
          </>
        ) : error ? (
          <>
            <AlertTriangle className="h-5 w-5 text-ui-danger" />
            <span className="text-sm text-ui-danger">{error}</span>
            <button
              onClick={reloadAll}
              className="mt-1 rounded-lg border border-white/10 px-3 py-1 text-xs text-ui-muted transition hover:text-ui-text"
            >
              重试
            </button>
          </>
        ) : (
          <>
            <ImageIcon className="h-5 w-5 opacity-50" />
            <span className="text-sm">暂无素材帧</span>
            <span className="text-[11px] text-ui-muted-subtle">在 _diag 目录生成 live_*.png 后刷新</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-140px)] gap-4">
      {/* 左侧：帧列表（缩略图 + 已核对折叠） */}
      <div className="flex w-72 shrink-0 flex-col rounded-xl border border-white/8 bg-ui-surface/40">
        <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
          <span className="text-sm font-medium text-ui-text">
            素材帧
            <span className="ml-1 text-[11px] text-ui-muted">
              （待核对 {activeFrames.length}
              {doneFrames.length > 0 ? ` · 已核对 ${doneFrames.length}` : ''}）
            </span>
          </span>
          <button
            onClick={reloadAll}
            className="rounded p-1 text-ui-muted transition hover:text-ui-text"
            title="刷新帧列表 / 标注"
          >
            <RefreshCw className={cn('h-4 w-4', framesLoading && 'animate-spin')} />
          </button>
        </div>
        <div className="border-b border-white/5 px-2 py-1.5">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] transition',
                  filter === k
                    ? 'bg-ui-accent/20 text-ui-accent ring-1 ring-ui-accent/40'
                    : 'bg-ui-surface-elevated/60 text-ui-muted hover:text-ui-text',
                )}
              >
                {k === 'all' ? '全部' : k}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {filteredFrames.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11px] text-ui-muted">该分类暂无素材帧</p>
          ) : (
            <>
              {activeFrames.map((f) => renderFrameItem(f))}
              {activeFrames.length === 0 && (
                <div className="mb-1 flex flex-col items-center gap-1 py-5 text-center text-ui-muted">
                  <CheckCheck className="h-4 w-4 text-ui-success" />
                  <span className="text-[11px]">该分类已全部核对</span>
                </div>
              )}
              {doneFrames.length > 0 && (
                <button
                  onClick={() => setShowDone((v) => !v)}
                  className="mb-1 flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] text-ui-muted transition hover:bg-white/5 hover:text-ui-text"
                >
                  <ChevronDown className={cn('h-3 w-3 transition-transform', !showDone && '-rotate-90')} />
                  已核对 {doneFrames.length} 帧
                  <span className="ml-auto text-ui-muted-subtle">{showDone ? '收起' : '展开'}</span>
                </button>
              )}
              {showDone && doneFrames.map((f) => renderFrameItem(f, true))}
            </>
          )}
        </div>
        <div className="border-t border-white/5 px-3 py-2 text-[11px] text-ui-muted">
          <div className="mb-1 flex items-center justify-between">
            <span>
              进度：<span className="text-ui-accent">{summary.done}</span>/{summary.total} 帧全标
            </span>
            <span>{summary.totalMarks} 个标注</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-ui-accent transition-all"
              style={{ width: `${summary.total ? Math.round((summary.done / summary.total) * 100) : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* 右侧：核对区 */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-white/8 bg-ui-surface/40 p-4">
        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-3 py-2 text-xs text-ui-danger">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={reloadAll} className="shrink-0 rounded px-2 py-0.5 text-[11px] hover:bg-ui-danger/20">
              重试
            </button>
          </div>
        )}

        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center text-ui-muted">
            <ImageIcon className="mb-3 h-12 w-12 opacity-40" />
            <p className="text-sm">← 从左侧选择一帧开始核对</p>
            <p className="mt-1 text-xs text-ui-muted-subtle">核对裁切是否偏移 + 识别是否正确</p>
          </div>
        ) : (
          <>
            {/* 头部 */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <FrameThumb frame={selected.name} done={isFrameDone(selected.name)} className="h-10 w-16" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-ui-text">{selected.name}</span>
                    <span className="text-[11px] text-ui-muted">{selected.mtime}</span>
                    <button
                      onClick={openPreview}
                      className="inline-flex items-center gap-1 rounded bg-ui-surface-elevated/60 px-2 py-0.5 text-[11px] text-ui-muted transition hover:bg-ui-surface-elevated hover:text-ui-text"
                    >
                      <Maximize2 className="h-3 w-3" />
                      查看原图
                    </button>
                  </div>
                  <div className="mt-0.5 text-[10px] text-ui-muted-subtle">
                    当前帧进度{' '}
                    <span className={cn(stats.marked >= DONE_MARK_COUNT ? 'text-ui-success' : 'text-ui-text')}>
                      {stats.marked}/{DONE_MARK_COUNT}
                    </span>{' '}
                    · 正确 <span className="text-ui-success">{stats.correct}</span> / 错误{' '}
                    <span className="text-ui-danger">{stats.wrong}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(['ban', 'pick'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m);
                      if (selected) loadCrops(selected, m);
                    }}
                    className={cn(
                      'rounded-lg px-3 py-1 text-xs font-medium transition',
                      mode === m
                        ? 'bg-ui-accent/20 text-ui-accent ring-1 ring-ui-accent/40'
                        : 'bg-ui-surface-elevated/60 text-ui-muted hover:text-ui-text',
                    )}
                  >
                    {m === 'ban' ? 'Ban 位' : 'Pick 位'}
                  </button>
                ))}
                <button
                  onClick={() => void bulkMark(true)}
                  disabled={bulkSaving}
                  className="inline-flex items-center gap-1 rounded-lg bg-ui-success/20 px-2.5 py-1 text-xs font-medium text-ui-success ring-1 ring-ui-success/40 transition hover:bg-ui-success/30 disabled:cursor-not-allowed disabled:opacity-50"
                  title="标记本帧 10 个位置全部正确（快捷键 1）"
                >
                  {bulkSaving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  本帧全部正确
                </button>
                <button
                  onClick={() => void bulkMark(false)}
                  disabled={bulkSaving}
                  className="inline-flex items-center gap-1 rounded-lg bg-ui-danger/20 px-2.5 py-1 text-xs font-medium text-ui-danger ring-1 ring-ui-danger/40 transition hover:bg-ui-danger/30 disabled:cursor-not-allowed disabled:opacity-50"
                  title="标记本帧 10 个位置全部错误（快捷键 0）"
                >
                  {bulkSaving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                  本帧全部错误
                </button>
                <button
                  onClick={() => exportMarks('csv')}
                  className="rounded-lg bg-ui-surface-elevated/60 px-2.5 py-1 text-xs font-medium text-ui-muted transition hover:bg-ui-surface-elevated hover:text-ui-text"
                  title="导出标注（Excel 可直接打开）"
                >
                  导出 CSV
                </button>
                <button
                  onClick={() => exportMarks('json')}
                  className="rounded-lg bg-ui-surface-elevated/60 px-2.5 py-1 text-xs font-medium text-ui-muted transition hover:bg-ui-surface-elevated hover:text-ui-text"
                  title="导出标注（JSON）"
                >
                  导出 JSON
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex h-40 items-center justify-center text-ui-muted">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                加载裁切...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                {SIDES.map((side) =>
                  Array.from({ length: SLOTS_PER_SIDE }, (_, i) => i + 1).map((idx) => {
                    const key = `${side}${idx}`;
                    const c = crops[key];
                    const mk = getMark(side, idx);
                    return (
                      <div
                        key={key}
                        className={cn(
                          'rounded-xl border p-2 transition',
                          mk
                            ? mk.correct
                              ? 'border-ui-success/40 bg-ui-success/5'
                              : 'border-ui-danger/40 bg-ui-danger/5'
                            : 'border-white/8 bg-ui-bg/40',
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className={side === 'blue' ? 'text-ui-accent' : 'text-ui-danger'}>
                            {side === 'blue' ? '蓝' : '红'} {idx}
                          </span>
                          {c && (
                            <span
                              className={cn(
                                'rounded px-1',
                                c.lane_icon && selected.kind === 'selecting'
                                  ? 'bg-ui-purple/20 text-ui-purple'
                                  : c.confident
                                    ? 'text-ui-success'
                                    : 'text-ui-warning',
                              )}
                            >
                              {c.lane_icon && selected.kind === 'selecting'
                                ? '图标'
                                : c.confident
                                  ? '高'
                                  : '低'}
                            </span>
                          )}
                        </div>
                        <div className="mx-auto mb-1 flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-ui-surface">
                          {c ? (
                            <img src={c.image} alt={`${side}${idx}`} className="h-20 w-20 object-cover" />
                          ) : (
                            <span className="text-[10px] text-ui-muted-subtle">空</span>
                          )}
                        </div>
                        <div className="mb-1 truncate text-center text-xs font-medium text-ui-text">
                          {c?.lane_icon && selected.kind === 'selecting' ? (
                            <span className="text-ui-purple">分路图标</span>
                          ) : (
                            c?.hero || '（空）'
                          )}
                        </div>
                        <div className="mb-1 text-center text-[10px] text-ui-muted-subtle">
                          gap={c?.gap != null ? c.gap.toFixed(4) : '-'}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setMark(key, true, mk?.note || '')}
                            className={cn(
                              'flex-1 rounded py-0.5 text-[11px] transition',
                              mk?.correct === true
                                ? 'bg-ui-success/30 text-ui-success'
                                : 'bg-ui-surface-elevated/60 text-ui-muted hover:bg-ui-success/20 hover:text-ui-success',
                            )}
                            title="标记正确"
                          >
                            <Check className="mx-auto h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setMark(key, false, mk?.note || '')}
                            className={cn(
                              'flex-1 rounded py-0.5 text-[11px] transition',
                              mk?.correct === false
                                ? 'bg-ui-danger/30 text-ui-danger'
                                : 'bg-ui-surface-elevated/60 text-ui-muted hover:bg-ui-danger/20 hover:text-ui-danger',
                            )}
                            title="标记错误"
                          >
                            <X className="mx-auto h-3.5 w-3.5" />
                          </button>
                        </div>
                        <input
                          value={mk?.note || ''}
                          onChange={(e) => setMark(key, mk?.correct ?? true, e.target.value)}
                          placeholder="备注（偏移/错认）"
                          className="mt-1 w-full rounded bg-ui-surface/80 px-1 py-0.5 text-[10px] text-ui-text placeholder:text-ui-muted-subtle focus:outline-none focus:ring-1 focus:ring-ui-accent/50"
                        />
                      </div>
                    );
                  }),
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ui-muted-subtle">
              <ChevronLeft className="h-3 w-3" />
              提示：先看裁切图是否居中，再核对英雄名是否正确。低置信（黄）会显示「?」。
              <span className="ml-2 text-ui-muted-subtle/70">
                快捷键：←/→ 切帧 · 1 全部正确 · 0 全部错误 · Esc 关预览
              </span>
              {dirty && <span className="text-ui-warning">保存中...</span>}
            </div>
          </>
        )}
      </div>

      {/* 原图预览 */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(null)}
        >
          <img
            src={preview}
            alt="原图预览"
            className="max-h-full max-w-full rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setPreview(null)}
            className="absolute right-6 top-6 rounded-full bg-ui-surface-elevated/80 px-3 py-1.5 text-sm text-ui-text transition hover:bg-ui-surface-elevated"
          >
            关闭（Esc）
          </button>
        </div>
      )}
    </div>
  );
}
