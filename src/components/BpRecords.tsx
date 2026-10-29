import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Trophy,
  Target,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  NotebookText,
  Shield,
  Swords,
  FileSpreadsheet,
  User,
  Crown,
  Skull,
  Filter,
  Pencil,
  Search,
  X,
  ArrowUpDown,
  Star,
  RotateCcw,
} from 'lucide-react';
import { useBpRecordStore } from '@/store/bpRecordStore';
import { RecordEditModal } from '@/components/RecordEditModal';
import { getHeroById } from '@/services/heroService';
import { cn, isTauri } from '@/lib/utils';
import { ROLE_LABELS } from '@/data/config';
import writeXlsxFile from 'write-excel-file/browser';
import type { SheetData } from 'write-excel-file/browser';
import type { BpRecord, BpRecordResult, HeroRole } from '@/types';

const EXCEL_HEADERS = [
  '时间',
  '预测结果',
  '预测倾向',
  '蓝方评分',
  '红方评分',
  '蓝方阵容',
  '红方阵容',
  '蓝方Ban',
  '红方Ban',
  '我的英雄',
  '我的位置',
  '我的结果',
  '备注',
] as const;

const EXCEL_COLUMN_WIDTHS = [16, 12, 12, 10, 10, 30, 30, 30, 30, 10, 8, 8, 24];

function buildSheetData(records: BpRecord[]): SheetData {
  const headerRow: SheetData[number] = EXCEL_HEADERS.map((header) => ({
    value: header,
    fontWeight: 'bold' as const,
    backgroundColor: '#1f2937',
    textColor: '#ffffff',
    align: 'center' as const,
  }));

  const dataRows: SheetData = records.map((record) => [
    formatTime(record.timestamp),
    record.result === 'CORRECT'
      ? '预测正确'
      : record.result === 'INCORRECT'
      ? '预测错误'
      : '待标记',
    record.favored === 'BLUE'
      ? '蓝方优势'
      : record.favored === 'RED'
      ? '红方优势'
      : '势均力敌',
    record.bluePower.toFixed(1),
    record.redPower.toFixed(1),
    record.bluePicks.map((id) => getHeroById(id)?.name || id).join('、'),
    record.redPicks.map((id) => getHeroById(id)?.name || id).join('、'),
    record.blueBans.map((id) => getHeroById(id)?.name || id).join('、'),
    record.redBans.map((id) => getHeroById(id)?.name || id).join('、'),
    record.myHeroId ? getHeroById(record.myHeroId)?.name || record.myHeroId : '',
    record.myRole ? ROLE_LABELS[record.myRole] ?? record.myRole : '',
    record.actualResult === 'WIN' ? '赢' : record.actualResult === 'LOSE' ? '输' : '',
    record.note || '',
  ]);

  return [headerRow, ...dataRows];
}

async function exportRecordsToExcel(records: BpRecord[]) {
  const data = buildSheetData(records);
  const dateStr = new Date().toLocaleDateString('zh-CN');
  const defaultName = `BP记录_${dateStr}.xlsx`;
  const columns = EXCEL_COLUMN_WIDTHS.map((width) => ({ width }));

  const blob = await writeXlsxFile(data, { sheet: 'BP 记录', columns }).toBlob();

  if (isTauri()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (filePath) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(filePath, buf);
      }
    } catch (err) {
      console.error('导出失败：', err);
      alert(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------- 记录筛选 / 排序 ----------
type ResultFilter = 'ALL' | 'CORRECT' | 'INCORRECT' | 'PENDING';
type ActualFilter = 'ALL' | 'WIN' | 'LOSE' | 'UNSET';
type RatingFilter = 'ALL' | 'HIGH' | 'MID' | 'LOW' | 'NONE';
type SortKey = 'TIME_DESC' | 'TIME_ASC' | 'RATING_DESC' | 'RATING_ASC' | 'HERO_WINRATE';

const RESULT_FILTERS: Array<{ value: ResultFilter; label: string }> = [
  { value: 'ALL', label: '全部结果' },
  { value: 'CORRECT', label: '预测正确' },
  { value: 'INCORRECT', label: '预测错误' },
  { value: 'PENDING', label: '待标记' },
];

const ACTUAL_FILTERS: Array<{ value: ActualFilter; label: string }> = [
  { value: 'ALL', label: '全部胜负' },
  { value: 'WIN', label: '我赢了' },
  { value: 'LOSE', label: '我输了' },
  { value: 'UNSET', label: '未填胜负' },
];

const RATING_FILTERS: Array<{ value: RatingFilter; label: string }> = [
  { value: 'ALL', label: '全部评分' },
  { value: 'HIGH', label: '高分 ≥12' },
  { value: 'MID', label: '中分 9-11.9' },
  { value: 'LOW', label: '低分 <9' },
  { value: 'NONE', label: '未评分' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'TIME_DESC', label: '时间（新→旧）' },
  { value: 'TIME_ASC', label: '时间（旧→新）' },
  { value: 'RATING_DESC', label: '评分（高→低）' },
  { value: 'RATING_ASC', label: '评分（低→高）' },
  { value: 'HERO_WINRATE', label: '英雄胜率' },
];

const MEDAL_STYLES: Record<'GOLD' | 'SILVER' | 'BRONZE', string> = {
  GOLD: 'bg-ui-warning/15 text-ui-warning border-ui-warning/25',
  SILVER: 'bg-ui-surface-elevated/70 text-ui-muted border-white/15',
  BRONZE: 'bg-amber-700/15 text-amber-600 border-amber-700/25',
};

const MEDAL_LABELS: Record<'GOLD' | 'SILVER' | 'BRONZE', string> = {
  GOLD: '金牌',
  SILVER: '银牌',
  BRONZE: '铜牌',
};

function matchRating(rating: number | undefined, filter: RatingFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'NONE') return rating == null;
  if (rating == null) return false;
  if (filter === 'HIGH') return rating >= 12;
  if (filter === 'MID') return rating >= 9 && rating < 12;
  return rating < 9;
}

function ResultBadge({ result }: { result: BpRecordResult }) {
  if (result === 'CORRECT') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-ui-success/15 text-ui-success border border-ui-success/25">
        <CheckCircle2 className="w-3 h-3" />
        预测正确
      </span>
    );
  }
  if (result === 'INCORRECT') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-ui-danger/15 text-ui-danger border border-ui-danger/25">
        <XCircle className="w-3 h-3" />
        预测错误
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-ui-warning/15 text-ui-warning border border-ui-warning/25">
      <Clock className="w-3 h-3" />
      待标记
    </span>
  );
}

function ActualResultBadge({ result }: { result?: 'WIN' | 'LOSE' | 'PENDING' }) {
  if (result === 'WIN') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-ui-primary/15 text-ui-primary-light border border-ui-primary/25">
        <Crown className="w-3 h-3" />
        我赢了
      </span>
    );
  }
  if (result === 'LOSE') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-ui-danger/15 text-ui-danger border border-ui-danger/25">
        <Skull className="w-3 h-3" />
        我输了
      </span>
    );
  }
  return null;
}

function HeroTags({ ids, color }: { ids: string[]; color: 'blue' | 'red' }) {
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const hero = getHeroById(id);
        return (
          <span
            key={id}
            className={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium border',
              color === 'blue'
                ? 'bg-ui-primary/10 text-ui-primary-light border-ui-primary/20'
                : 'bg-ui-danger/10 text-ui-danger border-ui-danger/20'
            )}
          >
            {hero?.name || id}
          </span>
        );
      })}
    </div>
  );
}

function RecordCard({ record, onDelete, onEdit, highlightHeroId }: { record: BpRecord; onDelete: (id: string) => void; onEdit: (record: BpRecord) => void; highlightHeroId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const myHero = record.myHeroId ? getHeroById(record.myHeroId) : null;

  return (
    <div className={cn(
      "glass rounded-2xl border overflow-hidden transition-all hover:border-white/12",
      highlightHeroId && record.myHeroId === highlightHeroId ? "border-ui-accent/30" : "border-white/8"
    )}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <ResultBadge result={record.result} />
              {record.actualResult && <ActualResultBadge result={record.actualResult} />}
              {typeof record.rating === 'number' && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border',
                    record.rating >= 12
                      ? 'bg-ui-warning/15 text-ui-warning border-ui-warning/25'
                      : 'bg-ui-surface/60 text-ui-muted border-white/8'
                  )}
                  title="对局评分"
                >
                  <Star className="w-3 h-3" />
                  {record.rating.toFixed(1)}
                </span>
              )}
              {record.isMvp && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-ui-warning/15 text-ui-warning border border-ui-warning/25"
                  title="本局 MVP"
                >
                  <Crown className="w-3 h-3" />
                  MVP
                </span>
              )}
              {record.medal && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border',
                    MEDAL_STYLES[record.medal]
                  )}
                  title="结算奖牌"
                >
                  {MEDAL_LABELS[record.medal]}
                </span>
              )}
              <span className="text-[11px] text-ui-muted">{formatTime(record.timestamp)}</span>
            </div>

            <div className="flex items-center gap-2 text-xs text-ui-text flex-wrap">
              <span className="font-medium text-ui-primary-light">蓝 {record.bluePower.toFixed(1)}</span>
              <span className="text-ui-muted">vs</span>
              <span className="font-medium text-ui-danger">红 {record.redPower.toFixed(1)}</span>
              <span className="text-ui-muted ml-1">
                预测：
                {record.favored === 'BLUE'
                  ? '蓝方优势'
                  : record.favored === 'RED'
                  ? '红方优势'
                  : '势均力敌'}
              </span>
              {myHero && (
                <span className="inline-flex items-center gap-1 text-[11px] text-ui-accent bg-ui-accent/10 border border-ui-accent/20 px-1.5 py-0.5 rounded-md">
                  <User className="w-3 h-3" />
                  {myHero.name}
                  {record.myRole && `·${record.myRole}`}
                </span>
              )}
            </div>

            {record.note && (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ui-muted">
                <NotebookText className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{record.note}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-1.5 rounded-lg text-ui-muted hover:text-ui-text hover:bg-white/5 transition-colors"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => onEdit(record)}
              className="p-1.5 rounded-lg text-ui-muted hover:text-ui-primary hover:bg-ui-primary/10 transition-colors"
              title="编辑记录"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDelete(record.id)}
              className="p-1.5 rounded-lg text-ui-muted hover:text-ui-danger hover:bg-ui-danger/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-ui-primary-light">
                <Swords className="w-3 h-3" />
                蓝方阵容
              </div>
              <HeroTags ids={record.bluePicks} color="blue" />
              <div className="flex items-center gap-1.5 text-[10px] text-ui-muted">
                <Shield className="w-3 h-3" />
                Ban：
                {record.blueBans.length > 0
                  ? record.blueBans.map((id) => getHeroById(id)?.name || id).join('、')
                  : '无'}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-ui-danger">
                <Swords className="w-3 h-3" />
                红方阵容
              </div>
              <HeroTags ids={record.redPicks} color="red" />
              <div className="flex items-center gap-1.5 text-[10px] text-ui-muted">
                <Shield className="w-3 h-3" />
                Ban：
                {record.redBans.length > 0
                  ? record.redBans.map((id) => getHeroById(id)?.name || id).join('、')
                  : '无'}
              </div>
            </div>
          </div>
          {record.note && (
            <div className="mt-3 p-2.5 rounded-xl bg-ui-surface/60 border border-white/8 flex items-start gap-2">
              <NotebookText className="w-3.5 h-3.5 text-ui-muted flex-shrink-0 mt-0.5" />
              <span className="text-[11px] text-ui-muted leading-relaxed">{record.note}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BpRecords() {
  const { records, deleteRecord, clearAll, getStats } = useBpRecordStore();
  const stats = useMemo(() => getStats(), [records, getStats]);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [heroFilter, setHeroFilter] = useState<string>('ALL');
  const [editingRecord, setEditingRecord] = useState<BpRecord | null>(null);
  // 搜索 / 筛选 / 排序
  const [query, setQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('ALL');
  const [actualFilter, setActualFilter] = useState<ActualFilter>('ALL');
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('ALL');
  const [mvpOnly, setMvpOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('TIME_DESC');
  const searchRef = useRef<HTMLInputElement | null>(null);

  // 快捷键：/ 聚焦搜索，Esc 清空搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && el === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 收集所有有 myHeroId 的记录中的英雄列表
  const myHeroOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; role?: HeroRole }>();
    for (const r of records) {
      if (r.myHeroId && !map.has(r.myHeroId)) {
        const hero = getHeroById(r.myHeroId);
        map.set(r.myHeroId, { id: r.myHeroId, name: hero?.name || r.myHeroId, role: r.myRole });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [records]);

  // 搜索索引：英雄名 / 备注 / 位置 / 结果
  const searchIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) {
      const names = [r.myHeroId, ...r.bluePicks, ...r.redPicks, ...r.blueBans, ...r.redBans]
        .filter((id): id is string => Boolean(id))
        .map((id) => getHeroById(id)?.name || id);
      const roleLabel = r.myRole ? ROLE_LABELS[r.myRole] ?? r.myRole : '';
      const resultLabel =
        r.result === 'CORRECT' ? '预测正确' : r.result === 'INCORRECT' ? '预测错误' : '待标记';
      const actualLabel =
        r.actualResult === 'WIN' ? '我赢了 胜' : r.actualResult === 'LOSE' ? '我输了 负' : '未填胜负';
      map.set(
        r.id,
        [names.join(' '), r.note || '', roleLabel, resultLabel, actualLabel, r.mySide || '']
          .join(' ')
          .toLowerCase(),
      );
    }
    return map;
  }, [records]);

  // 按英雄统计实际胜率
  const heroStats = useMemo(() => {
    const map = new Map<string, { id: string; name: string; wins: number; losses: number; total: number; role?: HeroRole }>();
    for (const r of records) {
      if (!r.myHeroId || !r.actualResult) continue;
      const existing = map.get(r.myHeroId);
      const hero = getHeroById(r.myHeroId);
      if (existing) {
        existing.total++;
        if (r.actualResult === 'WIN') existing.wins++;
        if (r.actualResult === 'LOSE') existing.losses++;
      } else {
        map.set(r.myHeroId, {
          id: r.myHeroId,
          name: hero?.name || r.myHeroId,
          wins: r.actualResult === 'WIN' ? 1 : 0,
          losses: r.actualResult === 'LOSE' ? 1 : 0,
          total: 1,
          role: r.myRole,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [records]);

  // 英雄胜率（用于「按英雄胜率」排序）
  const heroWinRateMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of heroStats) map.set(h.id, h.total > 0 ? h.wins / h.total : -1);
    return map;
  }, [heroStats]);

  // 过滤 + 排序后的记录
  const visibleRecords = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = records.filter((r) => {
      if (heroFilter !== 'ALL' && r.myHeroId !== heroFilter) return false;
      if (resultFilter !== 'ALL' && r.result !== resultFilter) return false;
      if (actualFilter !== 'ALL') {
        const actual = r.actualResult;
        if (actualFilter === 'UNSET' && actual && actual !== 'PENDING') return false;
        if (actualFilter === 'WIN' && actual !== 'WIN') return false;
        if (actualFilter === 'LOSE' && actual !== 'LOSE') return false;
      }
      if (!matchRating(r.rating, ratingFilter)) return false;
      if (mvpOnly && !r.isMvp) return false;
      if (q && !(searchIndex.get(r.id) || '').includes(q)) return false;
      return true;
    });

    const ratingOf = (r: BpRecord) => (typeof r.rating === 'number' ? r.rating : -1);
    switch (sortBy) {
      case 'TIME_ASC':
        list.sort((a, b) => a.timestamp - b.timestamp);
        break;
      case 'RATING_DESC':
        list.sort((a, b) => ratingOf(b) - ratingOf(a) || b.timestamp - a.timestamp);
        break;
      case 'RATING_ASC':
        list.sort((a, b) => ratingOf(a) - ratingOf(b) || b.timestamp - a.timestamp);
        break;
      case 'HERO_WINRATE':
        list.sort(
          (a, b) =>
            (heroWinRateMap.get(b.myHeroId || '') ?? -1) -
              (heroWinRateMap.get(a.myHeroId || '') ?? -1) || b.timestamp - a.timestamp,
        );
        break;
      default:
        list.sort((a, b) => b.timestamp - a.timestamp);
    }
    return list;
  }, [
    records,
    heroFilter,
    resultFilter,
    actualFilter,
    ratingFilter,
    mvpOnly,
    query,
    searchIndex,
    sortBy,
    heroWinRateMap,
  ]);

  const activeFilterCount =
    (heroFilter !== 'ALL' ? 1 : 0) +
    (resultFilter !== 'ALL' ? 1 : 0) +
    (actualFilter !== 'ALL' ? 1 : 0) +
    (ratingFilter !== 'ALL' ? 1 : 0) +
    (mvpOnly ? 1 : 0) +
    (query.trim() ? 1 : 0);

  const resetFilters = () => {
    setHeroFilter('ALL');
    setResultFilter('ALL');
    setActualFilter('ALL');
    setRatingFilter('ALL');
    setMvpOnly(false);
    setQuery('');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats header */}
      <div className="flex-none p-4 border-b border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-ui-primary to-ui-accent flex items-center justify-center shadow-glow-blue">
                <Trophy className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-sm font-bold text-ui-text">BP 记录</h2>
            </div>
            <div className="flex items-center gap-2">
              {records.length > 0 && (
                <button
                  onClick={() => exportRecordsToExcel(records)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-ui-success hover:bg-ui-success/10 border border-white/8 hover:border-ui-success/20 transition-colors"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  导出 Excel
                </button>
              )}
              {records.length > 0 && (
                <button
                  onClick={() => setShowConfirmClear(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-ui-muted hover:text-ui-danger hover:bg-ui-danger/10 border border-white/8 hover:border-ui-danger/20 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  清空全部
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <StatCard
              icon={NotebookText}
              label="总记录"
              value={stats.total}
              color="primary"
            />
            <StatCard
              icon={CheckCircle2}
              label="预测正确"
              value={stats.correct}
              color="success"
            />
            <StatCard
              icon={XCircle}
              label="预测错误"
              value={stats.incorrect}
              color="danger"
            />
            <StatCard
              icon={Target}
              label="正确率"
              value={`${(stats.accuracy * 100).toFixed(0)}%`}
              color="warning"
            />
          </div>

          {/* 搜索 / 筛选 / 排序 */}
          {records.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative w-full min-w-[200px] max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ui-muted" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索英雄名 / 备注…（按 / 聚焦）"
                  aria-label="搜索记录"
                  className="w-full rounded-lg border border-white/8 bg-ui-surface/60 py-1.5 pl-8 pr-8 text-xs text-ui-text placeholder:text-ui-muted-subtle focus:border-ui-primary/50 focus:outline-none"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ui-muted transition-colors hover:text-ui-text"
                    title="清空搜索"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <FilterSelect<ResultFilter>
                label="按预测结果筛选"
                value={resultFilter}
                onChange={setResultFilter}
                options={RESULT_FILTERS}
              />
              <FilterSelect<ActualFilter>
                label="按实际胜负筛选"
                value={actualFilter}
                onChange={setActualFilter}
                options={ACTUAL_FILTERS}
              />
              <FilterSelect<RatingFilter>
                label="按评分筛选"
                value={ratingFilter}
                onChange={setRatingFilter}
                options={RATING_FILTERS}
              />

              <button
                onClick={() => setMvpOnly((v) => !v)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors',
                  mvpOnly
                    ? 'border-ui-warning/40 bg-ui-warning/15 text-ui-warning'
                    : 'border-white/8 bg-ui-surface/60 text-ui-muted hover:border-white/15',
                )}
                title="只看 MVP 记录"
              >
                <Crown className="h-3 w-3" />
                MVP
              </button>

              <span className="inline-flex items-center gap-1 text-ui-muted">
                <ArrowUpDown className="h-3 w-3" />
                <FilterSelect<SortKey> label="排序方式" value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />
              </span>

              {activeFilterCount > 0 && (
                <button
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 rounded-lg border border-ui-accent/25 px-2 py-1.5 text-[11px] font-medium text-ui-accent transition-colors hover:bg-ui-accent/10"
                >
                  <RotateCcw className="h-3 w-3" />
                  清除筛选（{activeFilterCount}）
                </button>
              )}

              <span className="ml-auto text-[11px] text-ui-muted">
                匹配 <span className="text-ui-text">{visibleRecords.length}</span> / {records.length} 条
              </span>
            </div>
          )}

          {/* 英雄胜率统计 */}
          {heroStats.length > 0 && (
            <div className="mb-3 p-3 rounded-xl bg-ui-surface/60 border border-white/8">
              <div className="flex items-center gap-2 mb-2">
                <User className="w-3.5 h-3.5 text-ui-accent" />
                <span className="text-[11px] font-bold text-ui-text">我的英雄胜率</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {heroStats.map((h) => {
                  const winRate = h.total > 0 ? (h.wins / h.total) * 100 : 0;
                  const hero = getHeroById(h.id);
                  const marketRate = hero ? hero.aiWinRate * 100 : 0;
                  return (
                    <button
                      key={h.id}
                      onClick={() => setHeroFilter(h.id === heroFilter ? 'ALL' : h.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors',
                        heroFilter === h.id
                          ? 'bg-ui-accent/20 text-ui-accent border-ui-accent/40'
                          : 'bg-ui-surface/40 text-ui-muted border-white/8 hover:border-white/15'
                      )}
                    >
                      <span className="font-bold">{h.name}</span>
                      <span className="text-ui-muted">{h.role}</span>
                      <span className={cn(
                        'font-mono',
                        winRate >= 50 ? 'text-ui-success' : 'text-ui-danger'
                      )}>
                        {winRate.toFixed(0)}%
                      </span>
                      <span className="text-ui-muted/60">({h.wins}/{h.total})</span>
                      {marketRate > 0 && (
                        <span className="text-[10px] text-ui-muted/40">
                          大盘{marketRate.toFixed(1)}%
                        </span>
                      )}
                    </button>
                  );
                })}
                {heroFilter !== 'ALL' && (
                  <button
                    onClick={() => setHeroFilter('ALL')}
                    className="inline-flex items-center px-2 py-1 rounded-lg text-[11px] text-ui-accent border border-ui-accent/20 hover:bg-ui-accent/10 transition-colors"
                  >
                    清除筛选
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 筛选器 */}
          {myHeroOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-ui-muted" />
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => setHeroFilter('ALL')}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors',
                    heroFilter === 'ALL'
                      ? 'bg-ui-primary/15 text-ui-primary-light border-ui-primary/30'
                      : 'bg-ui-surface/40 text-ui-muted border-white/8 hover:border-white/15'
                  )}
                >
                  全部记录
                </button>
                {myHeroOptions.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => setHeroFilter(h.id)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors',
                      heroFilter === h.id
                        ? 'bg-ui-accent/15 text-ui-accent border-ui-accent/30'
                        : 'bg-ui-surface/40 text-ui-muted border-white/8 hover:border-white/15'
                    )}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Records list */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl mx-auto space-y-3">
          {records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-ui-surface/80 border border-white/8 flex items-center justify-center mb-3">
                <NotebookText className="w-6 h-6 text-ui-muted" />
              </div>
              <p className="text-sm font-medium text-ui-muted mb-1">暂无记录</p>
              <p className="text-[11px] text-ui-muted/60 max-w-xs">
                完成一次 BP 模拟后，在结果页点击「记录本次 BP」即可保存记录。
              </p>
            </div>
          ) : visibleRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-ui-surface/80 border border-white/8 flex items-center justify-center mb-3">
                <Search className="w-6 h-6 text-ui-muted" />
              </div>
              <p className="text-sm font-medium text-ui-muted mb-1">没有匹配的记录</p>
              <p className="text-[11px] text-ui-muted/60 max-w-xs mb-4">
                调整搜索词或筛选条件试试。
              </p>
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-ui-accent border border-ui-accent/25 hover:bg-ui-accent/10 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                清除全部筛选
              </button>
            </div>
          ) : (
            visibleRecords.map((record) => (
              <RecordCard key={record.id} record={record} onDelete={deleteRecord} onEdit={setEditingRecord} highlightHeroId={heroFilter !== 'ALL' ? heroFilter : undefined} />
            ))
          )}
        </div>
      </div>

      <RecordEditModal
        open={!!editingRecord}
        record={editingRecord}
        onClose={() => setEditingRecord(null)}
      />

      {/* Clear confirmation modal */}
      {showConfirmClear && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass rounded-2xl border border-white/10 p-5 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-ui-danger/15 border border-ui-danger/25 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-ui-danger" />
              </div>
              <h3 className="text-sm font-bold text-ui-text">确认清空</h3>
            </div>
            <p className="text-xs text-ui-muted mb-5 leading-relaxed">
              此操作将删除全部 {records.length} 条 BP 记录，且无法恢复。是否继续？
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowConfirmClear(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-ui-muted hover:text-ui-text hover:bg-white/5 border border-white/8 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  clearAll();
                  setShowConfirmClear(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-ui-danger/15 text-ui-danger border border-ui-danger/25 hover:bg-ui-danger/25 transition-colors"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSelect<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-lg border border-white/8 bg-ui-surface/60 px-2 py-1.5 text-[11px] text-ui-text focus:border-ui-primary/50 focus:outline-none"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-ui-surface text-ui-text">
          {option.label}
        </option>
      ))}
    </select>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: 'primary' | 'success' | 'danger' | 'warning';
}) {
  const colorMap = {
    primary: 'from-ui-primary to-ui-accent text-ui-primary-light',
    success: 'from-ui-success to-emerald-400 text-ui-success',
    danger: 'from-ui-danger to-ui-warning text-ui-danger',
    warning: 'from-ui-warning to-amber-400 text-ui-warning',
  };

  return (
    <div className="relative p-3 rounded-xl bg-ui-surface/60 border border-white/8 text-center overflow-hidden">
      <div className={cn('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-60', colorMap[color].split(' ').slice(0, 2).join(' '))} />
      <Icon
        className={cn(
          'absolute right-2.5 top-2.5 w-4 h-4 opacity-25',
          colorMap[color].split(' ').slice(2).join(' ')
        )}
      />
      <div className="text-[11px] text-ui-muted mb-1">{label}</div>
      <div className={cn('text-xl font-display font-bold', colorMap[color].split(' ').slice(2).join(' '))}>
        {value}
      </div>
    </div>
  );
}
