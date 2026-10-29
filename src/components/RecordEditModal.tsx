import { useEffect, useMemo, useState } from 'react';
import { X, Search, Trash2, Save } from 'lucide-react';
import { useBpRecordStore } from '@/store/bpRecordStore';
import { getAllHeroes, getHeroById } from '@/services/heroService';
import { HeroAvatar } from '@/components/HeroAvatar';
import { cn } from '@/lib/utils';
import type { BpRecord, ActualResult, Hero } from '@/types';

/** 可编辑的槽位（用于英雄选择器）。 */
type SlotType = 'pick' | 'ban';

interface SlotKey {
  side: 'BLUE' | 'RED';
  type: SlotType;
  index: number;
}

interface RecordEditModalProps {
  open: boolean;
  record: BpRecord | null;
  onClose: () => void;
}

function slotArray(
  side: 'BLUE' | 'RED',
  type: SlotType,
  data: { bluePicks: string[]; redPicks: string[]; blueBans: string[]; redBans: string[] },
): string[] {
  if (side === 'BLUE') return type === 'pick' ? data.bluePicks : data.blueBans;
  return type === 'pick' ? data.redPicks : data.redBans;
}

/** 单格英雄按钮：显示头像/空位，点击打开选择器。 */
function HeroSlot({
  heroId,
  label,
  side,
  kind = 'pick',
  onClick,
  onClear,
}: {
  heroId?: string;
  label: string;
  side: 'BLUE' | 'RED';
  /** pick=正常；ban=红色禁用风 + 斜线 + 灰度，便于一眼区分 */
  kind?: 'pick' | 'ban';
  onClick: () => void;
  onClear: () => void;
}) {
  const hero = heroId ? getHeroById(heroId) : undefined;
  const isBan = kind === 'ban';
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={cn(
          'relative w-full aspect-square rounded-lg border flex flex-col items-center justify-center overflow-hidden transition-colors',
          hero
            ? isBan
              ? 'border-rose-500/50 bg-rose-500/8 grayscale-[0.7]'
              : side === 'BLUE'
                ? 'border-ui-primary/40 bg-ui-primary/10'
                : 'border-ui-danger/40 bg-ui-danger/10'
            : isBan
              ? 'border-rose-500/25 border-dashed bg-rose-500/4 hover:border-rose-500/45'
              : 'border-white/10 border-dashed bg-white/3 hover:border-white/25',
        )}
        title={label}
      >
        {hero ? (
          <>
            <HeroAvatar heroId={hero.id} size="sm" />
            <span className="text-[9px] text-ui-muted mt-0.5 truncate w-full text-center px-0.5">
              {hero.name}
            </span>
          </>
        ) : (
          <span className={cn('text-[10px]', isBan ? 'text-rose-400/50' : 'text-ui-muted/60')}>
            {isBan ? '空 Ban' : '空'}
          </span>
        )}
        {/* Ban 位斜线遮罩（一眼区分 ban / pick） */}
        {isBan && hero && (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(244,63,94,0.55)" strokeWidth="7" />
          </svg>
        )}
      </button>
      {hero && (
        <button
          onClick={onClear}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-ui-surface border border-white/20 text-ui-muted hover:text-ui-danger flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          title="清空"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

/** 记录编辑弹窗：改双方阵容 / 我的英雄 / 胜负 / 评分 / 备注。 */
export function RecordEditModal({ open, record, onClose }: RecordEditModalProps) {
  const updateRecord = useBpRecordStore((s) => s.updateRecord);

  const [bluePicks, setBluePicks] = useState<string[]>([]);
  const [redPicks, setRedPicks] = useState<string[]>([]);
  const [blueBans, setBlueBans] = useState<string[]>([]);
  const [redBans, setRedBans] = useState<string[]>([]);
  const [myHeroId, setMyHeroId] = useState<string | undefined>(undefined);
  const [actualResult, setActualResult] = useState<ActualResult>('PENDING');
  const [rating, setRating] = useState('');
  const [isMvp, setIsMvp] = useState(false);
  const [medal, setMedal] = useState<'GOLD' | 'SILVER' | 'BRONZE' | undefined>(undefined);
  const [note, setNote] = useState('');

  const [picker, setPicker] = useState<SlotKey | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [myHeroPicker, setMyHeroPicker] = useState(false);

  // 打开时把 record 同步到草稿
  useEffect(() => {
    if (!open || !record) return;
    setBluePicks([...record.bluePicks]);
    setRedPicks([...record.redPicks]);
    setBlueBans([...record.blueBans]);
    setRedBans([...record.redBans]);
    setMyHeroId(record.myHeroId);
    setActualResult(record.actualResult ?? 'PENDING');
    setRating(record.rating != null ? String(record.rating) : '');
    setIsMvp(!!record.isMvp);
    setMedal(record.medal);
    setNote(record.note ?? '');
    setPicker(null);
    setMyHeroPicker(false);
  }, [open, record?.id]);

  const heroes = useMemo(() => getAllHeroes(), []);

  const allUsedIds = useMemo(
    () => new Set([...bluePicks, ...redPicks, ...blueBans, ...redBans].filter(Boolean)),
    [bluePicks, redPicks, blueBans, redBans],
  );

  // 「我的英雄」候选集 = 双方 picks（不含 ban）：
  // 我的英雄必须是本局实际选出的英雄；ban 位英雄不可能是我的英雄。
  // 之前错误地用 allUsedIds（含 ban），导致用户能选 ban 英雄，保存时被静默清掉。
  const myHeroCandidates = useMemo(
    () => new Set([...bluePicks, ...redPicks].filter(Boolean)),
    [bluePicks, redPicks],
  );

  // 「我的英雄」是否有效（必须在双方 picks 里）；无效时保存会被清掉，需提示用户
  const myHeroValid = !!myHeroId && myHeroCandidates.has(myHeroId);

  const filteredHeroes = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((h) => h.name.includes(q) || h.id.toLowerCase().includes(q));
  }, [heroes, pickerSearch]);

  if (!open || !record) return null;

  const setSlot = (key: SlotKey, heroId: string | undefined) => {
    const data = { bluePicks, redPicks, blueBans, redBans };
    const arr = [...slotArray(key.side, key.type, data)];
    while (arr.length < 5) arr.push('');
    arr[key.index] = heroId ?? '';
    const clean = arr.slice(0, 5);
    if (key.side === 'BLUE') {
      if (key.type === 'pick') setBluePicks(clean);
      else setBlueBans(clean);
    } else {
      if (key.type === 'pick') setRedPicks(clean);
      else setRedBans(clean);
    }
  };

  const clearSlot = (key: SlotKey) => setSlot(key, undefined);

  const pickHeroForSlot = (heroId: string) => {
    if (picker) setSlot(picker, heroId);
    setPicker(null);
    setPickerSearch('');
  };

  const pickMyHero = (heroId: string) => {
    setMyHeroId(heroId);
    setMyHeroPicker(false);
    setPickerSearch('');
  };

  const handleSave = () => {
    // 我的英雄必须在我方 picks 里，否则清掉（避免脏数据）
    let nextMyHero = myHeroId;
    if (nextMyHero) {
      const inAny = bluePicks.includes(nextMyHero) || redPicks.includes(nextMyHero);
      if (!inAny) nextMyHero = undefined;
    }
    updateRecord(record.id, {
      bluePicks,
      redPicks,
      blueBans,
      redBans,
      myHeroId: nextMyHero,
      actualResult,
      rating: rating.trim() === '' ? undefined : Number(rating),
      isMvp: isMvp || undefined,
      medal,
      note: note.trim() || undefined,
    });
    onClose();
  };

  const renderSide = (side: 'BLUE' | 'RED') => {
    const picks = side === 'BLUE' ? bluePicks : redPicks;
    const bans = side === 'BLUE' ? blueBans : redBans;
    const setPicks = side === 'BLUE' ? setBluePicks : setRedPicks;
    const setBans = side === 'BLUE' ? setBlueBans : setRedBans;
    return (
      <div className="space-y-1.5">
        <div
          className={cn(
            'text-[11px] font-bold',
            side === 'BLUE' ? 'text-ui-primary-light' : 'text-ui-danger-light',
          )}
        >
          {side === 'BLUE' ? '蓝方' : '红方'}
        </div>
        {/* 选人行 */}
        <div className="flex items-center gap-1.5">
          <span className="w-9 shrink-0 text-right text-[9px] font-semibold text-ui-muted">
            选人
          </span>
          <div className="grid grid-cols-5 gap-1 flex-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <HeroSlot
                key={`p${i}`}
                heroId={picks[i]}
                label={`${side === 'BLUE' ? '蓝' : '红'}方选人 ${i + 1}`}
                side={side}
                kind="pick"
                onClick={() => setPicker({ side, type: 'pick', index: i })}
                onClear={() => {
                  const next = [...picks];
                  next[i] = '';
                  setPicks(next);
                }}
              />
            ))}
          </div>
        </div>
        {/* Ban 行（红色 + 斜线，明显区别于选人） */}
        <div className="flex items-center gap-1.5">
          <span className="w-9 shrink-0 text-right text-[9px] font-semibold text-rose-400/80">
            Ban
          </span>
          <div className="grid grid-cols-5 gap-1 flex-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <HeroSlot
                key={`b${i}`}
                heroId={bans[i]}
                label={`${side === 'BLUE' ? '蓝' : '红'}方禁用 ${i + 1}`}
                side={side}
                kind="ban"
                onClick={() => setPicker({ side, type: 'ban', index: i })}
                onClear={() => {
                  const next = [...bans];
                  next[i] = '';
                  setBans(next);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b1018] shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/8 sticky top-0 bg-[#0b1018] z-10">
          <h2 className="text-sm font-semibold text-white">编辑记录</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-ui-muted hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 双方阵容 */}
          <div className="space-y-3">
            {renderSide('BLUE')}
            {renderSide('RED')}
          </div>

          {/* 我的英雄 */}
          <div>
            <div className="text-[11px] font-semibold text-ui-muted mb-1.5">我的英雄</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMyHeroPicker(true)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs',
                  myHeroId
                    ? 'border-ui-accent/40 bg-ui-accent/10 text-ui-accent'
                    : 'border-white/10 bg-white/5 text-ui-muted hover:border-white/25',
                )}
              >
                {myHeroId ? (
                  <>
                    <HeroAvatar heroId={myHeroId} size="sm" />
                    {getHeroById(myHeroId)?.name || myHeroId}
                  </>
                ) : (
                  '选择我的英雄'
                )}
              </button>
              {myHeroId && (
                <button
                  onClick={() => setMyHeroId(undefined)}
                  className="p-1.5 rounded-lg text-ui-muted hover:text-ui-danger hover:bg-ui-danger/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <span className="text-[10px] text-ui-muted-subtle">
                （必须在本局双方已选英雄里）
              </span>
              {myHeroId && !myHeroValid && (
                <span className="text-[10px] text-amber-400">
                  ⚠ 当前英雄不在本局已选阵容里，保存时会被清空
                </span>
              )}
            </div>
          </div>

          {/* 对局结果 + 评分 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-ui-muted">对局结果：</span>
            {(['WIN', 'LOSE', 'PENDING'] as ActualResult[]).map((r) => (
              <button
                key={r}
                onClick={() => setActualResult(r)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-[11px] font-medium border',
                  actualResult === r
                    ? r === 'WIN'
                      ? 'bg-ui-primary/20 text-ui-primary-light border-ui-primary/40'
                      : r === 'LOSE'
                        ? 'bg-ui-danger/20 text-ui-danger-light border-ui-danger/40'
                        : 'bg-ui-warning/15 text-ui-warning border-ui-warning/30'
                    : 'bg-ui-surface/40 text-ui-muted border-white/8 hover:border-white/15',
                )}
              >
                {r === 'WIN' ? '赢' : r === 'LOSE' ? '输' : '未定'}
              </button>
            ))}
            <span className="text-[11px] text-ui-muted ml-3">评分：</span>
            <input
              type="number"
              min={0}
              max={16}
              step={0.1}
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              placeholder="0~16"
              className="w-20 px-2 py-1 rounded-lg bg-ui-surface/60 border border-white/10 text-xs text-ui-text outline-none"
            />
            <button
              onClick={() => setIsMvp((v) => !v)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-semibold border',
                isMvp
                  ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                  : 'bg-ui-surface/40 text-ui-muted border-white/8',
              )}
            >
              MVP
            </button>
            {(['GOLD', 'SILVER', 'BRONZE'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMedal(medal === m ? undefined : m)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-[11px] font-semibold border',
                  medal === m
                    ? m === 'GOLD'
                      ? 'bg-yellow-500/20 text-yellow-300 border-yellow-400/40'
                      : m === 'SILVER'
                        ? 'bg-slate-400/20 text-slate-200 border-slate-300/40'
                        : 'bg-orange-700/20 text-orange-300 border-orange-500/40'
                    : 'bg-ui-surface/40 text-ui-muted border-white/8',
                )}
              >
                {m === 'GOLD' ? '金牌' : m === 'SILVER' ? '银牌' : '铜牌'}
              </button>
            ))}
          </div>

          {/* 备注 */}
          <div>
            <div className="text-[11px] font-semibold text-ui-muted mb-1.5">备注</div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="这局的心得 / 复盘笔记..."
              className="w-full px-3 py-2 rounded-lg bg-ui-surface/60 border border-white/10 text-xs text-ui-text outline-none resize-none"
            />
          </div>

          {/* 底部按钮 */}
          <div className="flex justify-end gap-2 pt-2 border-t border-white/8">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-white/5 text-xs text-ui-muted hover:bg-white/10"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ui-primary/20 text-ui-primary-light text-xs font-semibold hover:bg-ui-primary/30"
            >
              <Save className="w-3.5 h-3.5" />
              保存
            </button>
          </div>
        </div>
      </div>

      {/* 英雄选择器（覆盖层） */}
      {(picker || myHeroPicker) && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl border border-white/10 bg-[#0b1018] shadow-2xl">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
              <span className="text-[11px] font-semibold text-ui-accent shrink-0">
                {picker ? '选择英雄' : '选择我的英雄（仅双方已选）'}
              </span>
              <Search className="w-4 h-4 text-ui-muted" />
              <input
                autoFocus
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="搜索英雄..."
                className="flex-1 bg-transparent text-sm text-ui-text outline-none placeholder:text-ui-muted"
              />
              <button
                onClick={() => {
                  setPicker(null);
                  setMyHeroPicker(false);
                  setPickerSearch('');
                }}
                className="p-1 rounded text-ui-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 grid grid-cols-6 sm:grid-cols-8 gap-2">
              {filteredHeroes.map((h: Hero) => {
                // 槽位选择：禁用已出场英雄（ban + pick 都不能重复），
                //   但允许重选「当前这个槽位自己的英雄」（避免改不动）
                // 我的英雄选择：只允许双方 picks 里的英雄（ban 位不可选）
                const currentSlotHero = picker
                  ? slotArray(picker.side, picker.type, { bluePicks, redPicks, blueBans, redBans })[
                      picker.index
                    ]
                  : undefined;
                const used = picker
                  ? allUsedIds.has(h.id) && h.id !== currentSlotHero
                  : !myHeroCandidates.has(h.id);
                return (
                  <button
                    key={h.id}
                    onClick={() => (picker ? pickHeroForSlot(h.id) : pickMyHero(h.id))}
                    className={cn(
                      'flex flex-col items-center gap-0.5 p-1 rounded-lg transition-colors',
                      used ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/8',
                    )}
                    disabled={used}
                    title={h.name}
                  >
                    <HeroAvatar heroId={h.id} size="sm" />
                    <span className="text-[9px] text-ui-muted truncate w-full text-center">
                      {h.name}
                    </span>
                  </button>
                );
              })}
              {filteredHeroes.length === 0 && (
                <p className="col-span-full text-center text-xs text-ui-muted py-6">
                  没有匹配的英雄
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
