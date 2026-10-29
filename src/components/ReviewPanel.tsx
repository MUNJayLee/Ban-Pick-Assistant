import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, X, RefreshCw, ImageIcon, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

const API = 'http://127.0.0.1:8900';

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

const SIDES: Array<'blue' | 'red'> = ['blue', 'red'];

export function ReviewPanel() {
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [filter, setFilter] = useState<'all' | 'ban' | 'pick' | 'selecting' | 'other'>(() => {
    try {
      const saved = localStorage.getItem('review-filter');
      if (saved === 'all' || saved === 'ban' || saved === 'pick' || saved === 'selecting' || saved === 'other') {
        return saved;
      }
    } catch {
      /* ignore */
    }
    return 'ban';
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [selected, setSelected] = useState<FrameInfo | null>(null);
  const [mode, setMode] = useState<'ban' | 'pick'>('ban');
  const [crops, setCrops] = useState<Record<string, CropData>>({});
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [summary, setSummary] = useState<{ total: number; marked: number; done: number; totalMarks: number }>({
    total: 0, marked: 0, done: 0, totalMarks: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // ---------- 加载帧列表 ----------
  const loadFrames = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/review/frames?limit=100`);
      const d = await r.json();
      setFrames(d.frames || []);
    } catch {
      setError('无法连接 API（8900），请确认服务已启动');
    }
  }, []);

  // ---------- 加载标注 ----------
  const loadMarks = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/review/marks`);
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

  useEffect(() => {
    loadFrames();
    loadMarks();
    loadSummary();
  }, [loadFrames, loadMarks, loadSummary]);

  // ---------- 加载当前帧的裁切 ----------
  const loadCrops = useCallback(async (frame: FrameInfo, m: 'ban' | 'pick') => {
    setLoading(true);
    setError(null);
    const next: Record<string, CropData> = {};
    try {
      const tasks: Array<Promise<void>> = [];
      for (const side of SIDES) {
        for (let i = 1; i <= 5; i++) {
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

  // filter 持久化
  useEffect(() => {
    try {
      localStorage.setItem('review-filter', filter);
    } catch {
      /* ignore */
    }
  }, [filter]);

  // ---------- 选帧 ----------
  const handleSelect = useCallback(
    (f: FrameInfo) => {
      setSelected(f);
      setDirty(false);
      // ban 帧默认看 ban；pick/selecting 帧默认看 pick
      const m: 'ban' | 'pick' = f.kind === 'ban' ? 'ban' : 'pick';
      setMode(m);
      loadCrops(f, m);
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

  const filteredFrames = useMemo(
    () => (filter === 'all' ? frames : frames.filter((f) => f.kind === filter)),
    [frames, filter],
  );

  // 自动选中第一个帧（滤镜变化 / 首次加载时）
  useEffect(() => {
    if (filteredFrames.length > 0 && !selected) {
      handleSelect(filteredFrames[0]);
    }
  }, [filteredFrames, selected, handleSelect]);

  // ---------- 统计 ----------
  const stats = useMemo(() => {
    const keys = Object.keys(marks);
    const frameKeys = selected ? keys.filter((k) => k.startsWith(selected.name + '|' + mode + '|')) : [];
    return {
      total: keys.length,
      current: frameKeys.length,
      correct: frameKeys.filter((k) => marks[k].correct).length,
      wrong: frameKeys.filter((k) => !marks[k].correct).length,
    };
  }, [marks, selected, mode]);

  const markAllCorrect = useCallback(async () => {
    if (!selected) return;
    const tasks: Array<Promise<unknown>> = [];
    const next: Record<string, Mark> = {};
    for (const side of SIDES) {
      for (let i = 1; i <= 5; i++) {
        const key = `${selected.name}|${mode}|${side}|${i}`;
        next[key] = { correct: true, note: '' };
        tasks.push(
          fetch(`${API}/api/review/mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frame: selected.name, kind: mode, side, index: i, correct: true, note: '' }),
          }),
        );
      }
    }
    await Promise.all(tasks);
    setMarks((prev) => ({ ...prev, ...next }));
    void loadSummary();
    // 自动跳下一帧（方便连续核对）
    const idx = filteredFrames.findIndex((f) => f.name === selected.name);
    const nxt = filteredFrames[idx + 1];
    if (nxt) {
      window.setTimeout(() => handleSelect(nxt), 350);
    }
  }, [selected, mode, loadSummary, filteredFrames, handleSelect]);

  const goFrame = useCallback(
    (dir: 1 | -1) => {
      if (!filteredFrames.length) return;
      const idx = selected ? filteredFrames.findIndex((f) => f.name === selected.name) : -1;
      const next = filteredFrames[idx + dir];
      if (next) handleSelect(next);
    },
    [filteredFrames, selected, handleSelect],
  );

  const exportMarks = useCallback((format: 'json' | 'csv') => {
    window.open(`${API}/api/review/export?format=${format}`, '_blank');
  }, []);

  // 键盘快捷键：←/→ 切帧、1=全部正确、0=全部错误、Esc 关预览
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
      } else if (e.key === '1') {
        void markAllCorrect();
      } else if (e.key === '0') {
        // 全部标记为错误（快速标记整帧都有问题）
        const tasks: Array<Promise<unknown>> = [];
        for (const side of SIDES) {
          for (let i = 1; i <= 5; i++) {
            tasks.push(
              fetch(`${API}/api/review/mark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frame: selected.name, kind: mode, side, index: i, correct: false, note: '' }),
              }),
            );
          }
        }
        void Promise.all(tasks).then(() => {
          setMarks((prev) => {
            const next = { ...prev };
            for (const side of SIDES) {
              for (let i = 1; i <= 5; i++) {
                next[`${selected.name}|${mode}|${side}|${i}`] = { correct: false, note: '' };
              }
            }
            return next;
          });
          void loadSummary();
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, mode, goFrame, markAllCorrect, loadSummary]);

  const getMark = (side: string, index: number): Mark | undefined => {
    if (!selected) return undefined;
    return marks[`${selected.name}|${mode}|${side}|${index}`];
  };

  // ---------- 渲染 ----------
  if (!frames.length && !error) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
        加载素材...
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-140px)] gap-4">
      {/* 左侧：帧列表 */}
      <div className="flex w-64 shrink-0 flex-col rounded-xl border border-slate-700/50 bg-slate-800/40">
        <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2">
          <span className="text-sm font-medium text-slate-200">素材帧（{filteredFrames.length}）</span>
          <button
            onClick={() => {
              loadFrames();
              loadMarks();
              loadSummary();
            }}
            className="rounded p-1 text-slate-400 hover:text-slate-200"
            title="刷新"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-slate-700/50 px-2 py-1.5">
          <div className="flex flex-wrap gap-1">
            {(['ban', 'pick', 'selecting', 'other', 'all'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] transition',
                  filter === k
                    ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-500/40'
                    : 'bg-slate-700/40 text-slate-400 hover:text-slate-200',
                )}
              >
                {k === 'all' ? '全部' : k}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filteredFrames.map((f) => (
            <button
              key={f.name}
              onClick={() => handleSelect(f)}
              className={cn(
                'mb-1 w-full rounded-lg px-2 py-1.5 text-left text-xs transition',
                selected?.name === f.name
                  ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-500/40'
                  : 'text-slate-300 hover:bg-slate-700/50',
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn('truncate', f.kind === 'ban' && 'text-amber-300')}>
                  {Object.keys(marks).some((k) => k.startsWith(f.name + '|')) ? '✓ ' : ''}{f.name}
                </span>
                <span className="ml-1 shrink-0 text-slate-500">{f.mtime}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                <span className={cn(
                  'rounded px-1',
                  f.kind === 'ban' ? 'bg-amber-500/20 text-amber-300'
                    : f.kind === 'selecting' ? 'bg-purple-500/20 text-purple-300'
                    : f.kind === 'pick' ? 'bg-cyan-500/20 text-cyan-300'
                    : 'bg-slate-600/40 text-slate-400',
                )}>
                  {f.kind}
                </span>
                <span>{Math.round(f.size / 1024)}KB</span>
              </div>
            </button>
          ))}
        </div>
        <div className="border-t border-slate-700/50 px-3 py-2 text-[11px] text-slate-400">
          <div className="mb-1 flex items-center justify-between">
            <span>进度：<span className="text-cyan-300">{summary.done}</span>/{summary.total} 帧全标</span>
            <span>{summary.totalMarks} 个标注</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full rounded-full bg-cyan-500 transition-all"
              style={{ width: `${summary.total ? Math.round((summary.done / summary.total) * 100) : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* 右侧：核对区 */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-500">
            <ImageIcon className="mb-3 h-12 w-12 opacity-40" />
            <p className="text-sm">← 从左侧选择一帧开始核对</p>
            <p className="mt-1 text-xs text-slate-600">核对裁切是否偏移 + 识别是否正确</p>
          </div>
        ) : (
          <>
            {/* 头部 */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-slate-200">{selected.name}</span>
                <span className="text-xs text-slate-500">{selected.mtime}</span>
                <button
                  onClick={() => setPreview(`${API}/api/review/frame_raw?frame=${encodeURIComponent(selected.name)}`)}
                  className="rounded bg-slate-700/60 px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-slate-600"
                >
                  查看原图
                </button>
              </div>
              <div className="flex items-center gap-2">
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
                        ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-500/40'
                        : 'bg-slate-700/50 text-slate-400 hover:text-slate-200',
                    )}
                  >
                    {m === 'ban' ? 'Ban 位' : 'Pick 位'}
                  </button>
                ))}
                <button
                  onClick={() => void markAllCorrect()}
                  className="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-200 ring-1 ring-emerald-500/40 transition hover:bg-emerald-500/30"
                >
                  本帧全部正确
                </button>
                <button
                  onClick={() => exportMarks('csv')}
                  className="rounded-lg bg-slate-700/60 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-600"
                  title="导出标注（Excel 可直接打开）"
                >
                  导出 CSV
                </button>
                <button
                  onClick={() => exportMarks('json')}
                  className="rounded-lg bg-slate-700/60 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-600"
                  title="导出标注（JSON）"
                >
                  导出 JSON
                </button>
                <span className="ml-2 text-[11px] text-slate-500">
                  当前帧：正确 <span className="text-emerald-400">{stats.correct}</span> / 错误{' '}
                  <span className="text-rose-400">{stats.wrong}</span>
                </span>
              </div>
            </div>

            {error && (
              <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex h-40 items-center justify-center text-slate-400">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                加载裁切...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                {SIDES.map((side) =>
                  Array.from({ length: 5 }, (_, i) => i + 1).map((idx) => {
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
                              ? 'border-emerald-500/40 bg-emerald-500/5'
                              : 'border-rose-500/40 bg-rose-500/5'
                            : 'border-slate-700/60 bg-slate-900/30',
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className={side === 'blue' ? 'text-cyan-300' : 'text-rose-300'}>
                            {side === 'blue' ? '蓝' : '红'} {idx}
                          </span>
                          {c && (
                            <span
                              className={cn(
                                'rounded px-1',
                                c.lane_icon && selected.kind === 'selecting'
                                  ? 'bg-purple-500/20 text-purple-300'
                                  : c.confident
                                    ? 'text-emerald-400'
                                    : 'text-amber-400',
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
                        <div className="mx-auto mb-1 flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-slate-800">
                          {c ? (
                            <img src={c.image} alt={`${side}${idx}`} className="h-20 w-20 object-cover" />
                          ) : (
                            <span className="text-[10px] text-slate-600">空</span>
                          )}
                        </div>
                        <div className="mb-1 truncate text-center text-xs font-medium text-slate-200">
                          {c?.lane_icon && selected.kind === 'selecting' ? (
                            <span className="text-purple-300">分路图标</span>
                          ) : (
                            c?.hero || '（空）'
                          )}
                        </div>
                        <div className="mb-1 text-center text-[10px] text-slate-500">
                          gap={c?.gap != null ? c.gap.toFixed(4) : '-'}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setMark(key, true, mk?.note || '')}
                            className={cn(
                              'flex-1 rounded py-0.5 text-[11px] transition',
                              mk?.correct === true
                                ? 'bg-emerald-500/30 text-emerald-200'
                                : 'bg-slate-700/60 text-slate-400 hover:bg-emerald-500/20 hover:text-emerald-300',
                            )}
                          >
                            <Check className="mx-auto h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setMark(key, false, mk?.note || '')}
                            className={cn(
                              'flex-1 rounded py-0.5 text-[11px] transition',
                              mk?.correct === false
                                ? 'bg-rose-500/30 text-rose-200'
                                : 'bg-slate-700/60 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300',
                            )}
                          >
                            <X className="mx-auto h-3.5 w-3.5" />
                          </button>
                        </div>
                        <input
                          value={mk?.note || ''}
                          onChange={(e) => setMark(key, mk?.correct ?? true, e.target.value)}
                          placeholder="备注（偏移/错认）"
                          className="mt-1 w-full rounded bg-slate-800/80 px-1 py-0.5 text-[10px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                        />
                      </div>
                    );
                  }),
                )}
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <ChevronLeft className="h-3 w-3" />
              提示：先看裁切图是否居中，再核对英雄名是否正确。低置信（黄）会显示「?」。
              <span className="ml-2 text-slate-600">快捷键：←/→ 切帧 · 1 全部正确 · 0 全部错误 · Esc 关预览</span>
              {dirty && <span className="text-amber-400">保存中...</span>}
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
            className="absolute right-6 top-6 rounded-full bg-slate-700/80 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
          >
            关闭（Esc）
          </button>
        </div>
      )}
    </div>
  );
}
