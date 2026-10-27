import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, ScanLine, Check, Ban, Plus } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import { getAllHeroes, getHeroById } from '@/services/heroService';
import { initRecognizer, recognizeBans } from '@/services/recognizer';
import type { RecognizeResult } from '@/services/recognizer';
import { recordTrainingSample, recordRecognitionEvent } from '@/services/syncService';
import { useBpStore } from '@/store/bpStore';
import { cn } from '@/lib/utils';
import type { Side } from '@/types';

interface Props {
  onClose: () => void;
}

type SlotKey = 'blue' | 'red';
type EditTarget = { side: SlotKey; index: number };

const EMPTY_SLOTS = (): (RecognizeResult | null)[] => Array(5).fill(null);

// 易混淆英雄（ORB 特征相似、易误判，基于 scripts/find_confusable.py 诊断）
// 命中这些英雄时高亮提示，引导用户确认，避免错误标注污染训练样本
const CONFUSABLE_HEROES = new Set([
  // 超级混淆源（很多英雄都容易误判成它们）
  'cang', 'niumo', 'kongkonger', 'yunzhongjun', 'zhugeliang', 'liyuanfang',
  // 关羽混淆簇
  'guanyu', 'houyi', 'gongsunli', 'xiaoqiao',
  // 铠混淆簇
  'kai', 'simayi', 'damo', 'diaochan', 'luyana', 'zhenji',
  // 其它已知易混淆
  'dayu', 'dunshan', 'bailishouyue', 'sunbin', 'zhaoyun', 'fei',
]);

/** 判断一个槽位是否需要重点确认（识别结果命中易混淆英雄，或候选里出现多个易混淆英雄） */
function needsReview(r: RecognizeResult | null): boolean {
  if (!r?.heroId) return false;
  if (CONFUSABLE_HEROES.has(r.heroId)) return true;
  const cands = r.candidates || [];
  return cands.filter((c) => CONFUSABLE_HEROES.has(c.heroId)).length >= 2;
}

/** 从截图里按圆位置裁剪出头像，返回 JPEG base64（供训练样本上传） */
async function cropAvatar(
  file: File,
  pos: { x: number; y: number; r: number },
  size = 96
): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('图片加载失败'));
    img.src = url;
  });
  const sz = Math.floor(pos.r * 2.2);
  const sx = Math.max(0, pos.x - sz / 2);
  const sy = Math.max(0, pos.y - sz / 2);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 不可用');
  ctx.drawImage(img, sx, sy, sz, sz, 0, 0, size, size);
  URL.revokeObjectURL(url);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

/** 把整张截图降采样（最长边 1920，保留头像细节供训练用），返回 JPEG base64 */
async function downscaleImage(file: File, maxDim = 1920): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('图片加载失败'));
    img.src = url;
  });
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 不可用');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

export function ScreenshotImport({ onClose }: Props) {
  const importBans = useBpStore((s) => s.importBans);
  const heroes = useMemo(() => getAllHeroes(), []);

  const [recognizing, setRecognizing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('');
  const [blue, setBlue] = useState<(RecognizeResult | null)[]>(EMPTY_SLOTS);
  const [red, setRed] = useState<(RecognizeResult | null)[]>(EMPTY_SLOTS);
  const [side, setSide] = useState<Side>('BLUE');
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const shotFileRef = useRef<File | null>(null);
  const manualInputRef = useRef(0);   // 手动输入（非修正，如自己方预填）
  const correctionRef = useRef(0);    // 修正识别结果

  // 初始化识别器（加载 132 个头像模板，仅一次）
  useEffect(() => {
    initRecognizer(heroes.map((h) => h.id)).catch((e) =>
      console.warn('[import] 识别器初始化失败', e)
    );
  }, [heroes]);

  function padTo5(arr: RecognizeResult[]): (RecognizeResult | null)[] {
    return [...arr.slice(0, 5), ...Array(Math.max(0, 5 - arr.length)).fill(null)];
  }

  /** 把识别结果合并进当前槽位：只填补空位，保留用户已手动填的英雄 */
  function mergeRecognition(
    prev: (RecognizeResult | null)[],
    recognized: RecognizeResult[]
  ): (RecognizeResult | null)[] {
    const padded = padTo5(recognized);
    return prev.map((slot, i) => (slot?.heroId ? slot : padded[i] ?? null));
  }

  async function handleFile(file: File) {
    shotFileRef.current = file;
    setRecognizing(true);
    setStatus('识别中…（首次约需几秒，可先填其它空位）');
    // 不清空已填内容：识别完成后只填补空位，不覆盖手动输入
    try {
      const res = await recognizeBans(file);
      setBlue((prev) => mergeRecognition(prev, res.blue));
      setRed((prev) => mergeRecognition(prev, res.red));
      const n = res.blue.length + res.red.length;
      setStatus(
        n > 0
          ? `✓ 识别完成：蓝方识别 ${res.blue.length} 个、红方识别 ${res.red.length} 个（已填入空位，未覆盖你手动填的）`
          : '识别完成，未检测到 ban 头像（可能全空 ban）'
      );
    } catch (e) {
      setStatus('识别失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRecognizing(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !recognizing) handleFile(file);
  }

  // 预计算每个英雄的拼音和首字母（一次性），供搜索匹配
  const pinyinMap = useMemo(() => {
    const map = new Map<string, { py: string; ini: string }>();
    for (const h of heroes) {
      try {
        map.set(h.id, {
          py: pinyin(h.name, { toneType: 'none' }).replace(/\s+/g, '').toLowerCase(),
          ini: pinyin(h.name, { pattern: 'first', toneType: 'none' }).replace(/\s+/g, '').toLowerCase(),
        });
      } catch {
        map.set(h.id, { py: '', ini: '' });
      }
    }
    return map;
  }, [heroes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return heroes
      .filter((h) => {
        const p = pinyinMap.get(h.id);
        return (
          h.name.includes(query.trim()) ||
          h.id.includes(q) ||
          (p ? p.py.includes(q) : false) ||
          (p ? p.ini.includes(q) : false)
        );
      })
      .slice(0, 10);
  }, [heroes, query, pinyinMap]);

  function setSlot(target: EditTarget, heroId: string) {
    const prev = getSlot(target);
    // 区分「修正」和「手动输入」：prev 有识别结果(score>0)且改成了别的英雄 → 修正；否则算手动输入
    if (prev?.heroId && prev.score > 0 && prev.heroId !== heroId) {
      correctionRef.current += 1;
    } else {
      manualInputRef.current += 1;
    }
    const pos = prev?.pos;
    const upd = (arr: (RecognizeResult | null)[]) =>
      arr.map((r, i) => (i === target.index ? { heroId, score: 0, candidates: [], pos } : r));
    if (target.side === 'blue') setBlue(upd);
    else setRed(upd);
    setEdit(null);
    setQuery('');
  }

  function clearSlot(target: EditTarget) {
    const upd = (arr: (RecognizeResult | null)[]) =>
      arr.map((r, i) => (i === target.index ? null : r));
    if (target.side === 'blue') setBlue(upd);
    else setRed(upd);
    setEdit(null);
    setQuery('');
  }

  function getSlot(target: EditTarget): RecognizeResult | null {
    const arr = target.side === 'blue' ? blue : red;
    return arr[target.index] ?? null;
  }

  const blueBans = blue.map((r) => r?.heroId).filter(Boolean) as string[];
  const redBans = red.map((r) => r?.heroId).filter(Boolean) as string[];
  const reviewCount = [...blue, ...red].filter((r) => needsReview(r)).length;

  async function doImport() {
    // 生成批次号，把识别事件和训练样本关联起来（便于后续整批删除）
    const batchId = crypto.randomUUID();
    const file = shotFileRef.current;

    // 降采样整张截图并保存（供将来训练）
    const imageB64 = file ? await downscaleImage(file).catch(() => undefined) : undefined;

    // 记录一次识别事件（含最终 ban 位 + 手动输入/修正数 + 原始截图）
    recordRecognitionEvent({
      batchId,
      blueBans,
      redBans,
      manualInput: manualInputRef.current,
      corrections: correctionRef.current,
      imageB64,
    });

    // 采集所有「最终确认」的槽位作为训练样本（含修正后的和确认正确的），
    // 每次导入约 10 条，比只记修正提速约 10 倍，为深度学习积累数据。
    if (file) {
      [...blue, ...red].forEach((r) => {
        if (r?.heroId && r?.pos) {
          cropAvatar(file, r.pos)
            .then((imageB64) => recordTrainingSample({ heroId: r.heroId as string, imageB64, batchId }))
            .catch((e) => console.warn('[import] 采集训练样本失败', e));
        }
      });
    }
    importBans(blueBans, redBans, side);
    onClose();
  }

  const editingSlot = edit ? getSlot(edit) : null;

  return (
    <div
      className="fixed right-0 top-0 bottom-0 z-[100] w-[440px] max-w-[94vw] overflow-y-auto bg-ui-bg-elevated border-l border-white/10 shadow-2xl"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
      onDrop={onDrop}
    >
      <div className={cn('p-5 transition-colors', dragging ? 'ring-2 ring-inset ring-ui-accent/40' : '')}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-ui-primary to-ui-accent flex items-center justify-center">
              <ScanLine className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-sm font-bold">截图导入 Ban 位</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-ui-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 选边（提前到顶部，方便先确定阵营再填） */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-ui-muted shrink-0">我的阵营</span>
          <button
            onClick={() => setSide('BLUE')}
            className={cn(
              'flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors',
              side === 'BLUE' ? 'bg-ui-primary/20 text-ui-primary-light border-ui-primary/50' : 'bg-ui-surface text-ui-muted border-white/8'
            )}
          >
            蓝方（左）
          </button>
          <button
            onClick={() => setSide('RED')}
            className={cn(
              'flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors',
              side === 'RED' ? 'bg-ui-danger/20 text-ui-danger-light border-ui-danger/50' : 'bg-ui-surface text-ui-muted border-white/8'
            )}
          >
            红方（右）
          </button>
        </div>

        {/* 上传 */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={recognizing}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed text-sm font-semibold transition-colors',
            dragging
              ? 'border-ui-accent text-ui-accent bg-ui-accent/10'
              : 'border-ui-primary/40 text-ui-primary-light hover:bg-ui-primary/10'
          )}
        >
          <Upload className="w-4 h-4" />
          {recognizing ? '识别中…' : dragging ? '松开即可识别' : '上传或拖拽 ban 阶段结束的截图'}
        </button>
        {status && <p className={cn('text-xs mt-2', status.startsWith('✓') ? 'text-ui-success' : status.startsWith('识别失败') ? 'text-ui-danger' : 'text-ui-muted')}>{status}</p>}
        {reviewCount > 0 && (
          <p className="text-xs mt-2 text-ui-warning font-medium">
            ⚠ 有 {reviewCount} 个易混淆英雄位需确认（橙色高亮），点开核对后再导入
          </p>
        )}

        {/* 结果 */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          {([['blue', '蓝方（左）'], ['red', '红方（右）']] as [SlotKey, string][]).map(([slotKey, label]) => {
            const arr = slotKey === 'blue' ? blue : red;
            const isMine = slotKey === (side === 'BLUE' ? 'blue' : 'red');
            return (
              <div key={slotKey}>
                <p className={cn('text-xs mb-2', isMine ? 'text-ui-primary-light font-semibold' : 'text-ui-muted')}>
                  {isMine ? `我方 · ${label}` : label} · {arr.filter(Boolean).length} ban
                </p>
                <div className="space-y-1.5">
                  {arr.map((r, i) => {
                    const target: EditTarget = { side: slotKey, index: i };
                    const hero = r?.heroId ? getHeroById(r.heroId) : undefined;
                    const isEditing = edit?.side === slotKey && edit?.index === i;
                    const review = needsReview(r);
                    return (
                      <button
                        key={i}
                        onClick={() => { setEdit(target); setQuery(''); }}
                        title={review ? '易混淆英雄，请点开确认正确性（避免错标污染训练数据）' : undefined}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left text-sm transition-colors',
                          isEditing
                            ? 'border-ui-accent/50 bg-ui-accent/10'
                            : review
                              ? 'border-ui-warning/60 bg-ui-warning/10 hover:border-ui-warning/80'
                              : 'border-white/8 hover:border-white/15'
                        )}
                      >
                        {hero ? (
                          <>
                            <span className="w-6 h-6 rounded-full overflow-hidden bg-ui-surface flex items-center justify-center text-[10px] font-bold shrink-0">
                              {hero.name.charAt(0)}
                            </span>
                            <span className="flex-1 truncate">{hero.name}</span>
                            {review ? (
                              <span className="text-[10px] text-ui-warning font-semibold shrink-0">需确认</span>
                            ) : r?.score ? (
                              <span className="text-[10px] text-ui-muted">{r.score}</span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <span className="w-6 h-6 rounded-full overflow-hidden bg-ui-surface flex items-center justify-center shrink-0 text-ui-muted">
                              <Ban className="w-3.5 h-3.5" />
                            </span>
                            <span className="flex-1 truncate text-ui-muted">空 Ban（点击添加）</span>
                            <Plus className="w-3.5 h-3.5 text-ui-muted" />
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* 修正面板 */}
        {edit && (
          <div className="mt-3 p-3 rounded-xl bg-ui-surface/60 border border-white/8">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-ui-muted">
                {edit.side === 'blue' ? '蓝方' : '红方'} 第 {edit.index + 1} 位
              </p>
              <button
                onClick={() => clearSlot(edit)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-ui-danger border border-ui-danger/30 hover:bg-ui-danger/10 transition-colors"
              >
                <Ban className="w-3 h-3" />
                标记为空 Ban
              </button>
            </div>
            {editingSlot?.candidates?.length ? (
              <>
                <p className="text-xs text-ui-muted mb-2">候选（点击替换）</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {editingSlot.candidates.map((cand) => {
                    const h = getHeroById(cand.heroId);
                    return (
                      <button
                        key={cand.heroId}
                        onClick={() => setSlot(edit, cand.heroId)}
                        className="px-2.5 py-1 rounded-lg text-xs bg-ui-surface border border-white/8 hover:border-ui-primary/40 transition-colors"
                      >
                        {h?.name || cand.heroId}
                        <span className="ml-1 text-ui-muted">{cand.score}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
            <p className="text-xs text-ui-muted mb-2">搜索正确英雄（支持拼音/首字母）</p>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入名字 / 拼音 / 首字母…"
              className="w-full px-3 py-2 rounded-lg bg-ui-surface border border-white/8 text-sm text-ui-text placeholder:text-ui-muted focus:outline-none focus:border-ui-primary/50"
            />
            {filtered.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {filtered.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => setSlot(edit, h.id)}
                    className="px-2.5 py-1 rounded-lg text-xs bg-ui-surface border border-white/8 hover:border-ui-primary/40 transition-colors"
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={doImport}
          className="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-ui-primary to-ui-accent text-white text-sm font-bold shadow-glow-blue"
        >
          <Check className="w-4 h-4" />
          导入并进入 Pick 阶段（蓝 {blueBans.length} / 红 {redBans.length}）
        </button>
      </div>
    </div>
  );
}
