import { useMemo, useState } from 'react';
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
} from 'lucide-react';
import { useBpRecordStore } from '@/store/bpRecordStore';
import { getHeroById } from '@/services/heroService';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import type { BpRecord, BpRecordResult, HeroRole } from '@/types';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function buildWorkbook(records: BpRecord[]) {
  const rows = records.map((record) => ({
    时间: formatTime(record.timestamp),
    预测结果:
      record.result === 'CORRECT'
        ? '预测正确'
        : record.result === 'INCORRECT'
        ? '预测错误'
        : '待标记',
    预测倾向:
      record.favored === 'BLUE'
        ? '蓝方优势'
        : record.favored === 'RED'
        ? '红方优势'
        : '势均力敌',
    蓝方评分: record.bluePower.toFixed(1),
    红方评分: record.redPower.toFixed(1),
    蓝方阵容: record.bluePicks.map((id) => getHeroById(id)?.name || id).join('、'),
    红方阵容: record.redPicks.map((id) => getHeroById(id)?.name || id).join('、'),
    蓝方Ban: record.blueBans.map((id) => getHeroById(id)?.name || id).join('、'),
    红方Ban: record.redBans.map((id) => getHeroById(id)?.name || id).join('、'),
    我的英雄: record.myHeroId ? getHeroById(record.myHeroId)?.name || record.myHeroId : '',
    我的位置: record.myRole || '',
    我的结果: record.actualResult === 'WIN' ? '赢' : record.actualResult === 'LOSE' ? '输' : '',
    备注: record.note || '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BP 记录');

  ws['!cols'] = [
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 30 },
    { wch: 30 },
    { wch: 30 },
    { wch: 30 },
    { wch: 10 },
    { wch: 8 },
    { wch: 8 },
    { wch: 24 },
  ];

  return wb;
}

async function exportRecordsToExcel(records: BpRecord[]) {
  const wb = buildWorkbook(records);
  const dateStr = new Date().toLocaleDateString('zh-CN');
  const defaultName = `BP记录_${dateStr}.xlsx`;

  if (isTauri) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (filePath) {
        const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(filePath, new Uint8Array(data));
      }
    } catch (err) {
      console.error('导出失败：', err);
      alert(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    XLSX.writeFile(wb, defaultName);
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

function ResultBadge({ result }: { result: BpRecordResult }) {
  if (result === 'CORRECT') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-trae-success/15 text-trae-success border border-trae-success/25">
        <CheckCircle2 className="w-3 h-3" />
        预测正确
      </span>
    );
  }
  if (result === 'INCORRECT') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-trae-danger/15 text-trae-danger border border-trae-danger/25">
        <XCircle className="w-3 h-3" />
        预测错误
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-trae-warning/15 text-trae-warning border border-trae-warning/25">
      <Clock className="w-3 h-3" />
      待标记
    </span>
  );
}

function ActualResultBadge({ result }: { result?: 'WIN' | 'LOSE' | 'PENDING' }) {
  if (result === 'WIN') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-trae-primary/15 text-trae-primary-light border border-trae-primary/25">
        <Crown className="w-3 h-3" />
        我赢了
      </span>
    );
  }
  if (result === 'LOSE') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-trae-danger/15 text-trae-danger border border-trae-danger/25">
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
                ? 'bg-trae-primary/10 text-trae-primary-light border-trae-primary/20'
                : 'bg-trae-danger/10 text-trae-danger-light border-trae-danger/20'
            )}
          >
            {hero?.name || id}
          </span>
        );
      })}
    </div>
  );
}

function RecordCard({ record, onDelete, highlightHeroId }: { record: BpRecord; onDelete: (id: string) => void; highlightHeroId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const myHero = record.myHeroId ? getHeroById(record.myHeroId) : null;

  return (
    <div className={cn(
      "glass rounded-2xl border overflow-hidden transition-all hover:border-white/12",
      highlightHeroId && record.myHeroId === highlightHeroId ? "border-trae-accent/30" : "border-white/8"
    )}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <ResultBadge result={record.result} />
              {record.actualResult && <ActualResultBadge result={record.actualResult} />}
              <span className="text-[11px] text-trae-muted">{formatTime(record.timestamp)}</span>
            </div>

            <div className="flex items-center gap-2 text-xs text-trae-text flex-wrap">
              <span className="font-medium text-trae-primary-light">蓝 {record.bluePower.toFixed(1)}</span>
              <span className="text-trae-muted">vs</span>
              <span className="font-medium text-trae-danger-light">红 {record.redPower.toFixed(1)}</span>
              <span className="text-trae-muted ml-1">
                预测：
                {record.favored === 'BLUE'
                  ? '蓝方优势'
                  : record.favored === 'RED'
                  ? '红方优势'
                  : '势均力敌'}
              </span>
              {myHero && (
                <span className="inline-flex items-center gap-1 text-[11px] text-trae-accent bg-trae-accent/10 border border-trae-accent/20 px-1.5 py-0.5 rounded-md">
                  <User className="w-3 h-3" />
                  {myHero.name}
                  {record.myRole && `·${record.myRole}`}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-1.5 rounded-lg text-trae-muted hover:text-trae-text hover:bg-white/5 transition-colors"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => onDelete(record.id)}
              className="p-1.5 rounded-lg text-trae-muted hover:text-trae-danger hover:bg-trae-danger/10 transition-colors"
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
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-trae-primary-light">
                <Swords className="w-3 h-3" />
                蓝方阵容
              </div>
              <HeroTags ids={record.bluePicks} color="blue" />
              <div className="flex items-center gap-1.5 text-[10px] text-trae-muted">
                <Shield className="w-3 h-3" />
                Ban：
                {record.blueBans.length > 0
                  ? record.blueBans.map((id) => getHeroById(id)?.name || id).join('、')
                  : '无'}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-trae-danger-light">
                <Swords className="w-3 h-3" />
                红方阵容
              </div>
              <HeroTags ids={record.redPicks} color="red" />
              <div className="flex items-center gap-1.5 text-[10px] text-trae-muted">
                <Shield className="w-3 h-3" />
                Ban：
                {record.redBans.length > 0
                  ? record.redBans.map((id) => getHeroById(id)?.name || id).join('、')
                  : '无'}
              </div>
            </div>
          </div>
          {record.note && (
            <div className="mt-3 p-2.5 rounded-xl bg-trae-surface/60 border border-white/8 flex items-start gap-2">
              <NotebookText className="w-3.5 h-3.5 text-trae-muted flex-shrink-0 mt-0.5" />
              <span className="text-[11px] text-trae-muted leading-relaxed">{record.note}</span>
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

  const filteredRecords = useMemo(() => {
    if (heroFilter === 'ALL') return records;
    return records.filter((r) => r.myHeroId === heroFilter);
  }, [records, heroFilter]);

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats header */}
      <div className="flex-none p-4 border-b border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-trae-primary to-trae-accent flex items-center justify-center shadow-glow-blue">
                <Trophy className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-sm font-bold text-trae-text">BP 记录</h2>
            </div>
            <div className="flex items-center gap-2">
              {records.length > 0 && (
                <button
                  onClick={() => exportRecordsToExcel(records)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-trae-success hover:bg-trae-success/10 border border-white/8 hover:border-trae-success/20 transition-colors"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  导出 Excel
                </button>
              )}
              {records.length > 0 && (
                <button
                  onClick={() => setShowConfirmClear(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-trae-muted hover:text-trae-danger hover:bg-trae-danger/10 border border-white/8 hover:border-trae-danger/20 transition-colors"
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

          {/* 英雄胜率统计 */}
          {heroStats.length > 0 && (
            <div className="mb-3 p-3 rounded-xl bg-trae-surface/60 border border-white/8">
              <div className="flex items-center gap-2 mb-2">
                <User className="w-3.5 h-3.5 text-trae-accent" />
                <span className="text-[11px] font-bold text-trae-text">我的英雄胜率</span>
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
                          ? 'bg-trae-accent/20 text-trae-accent border-trae-accent/40'
                          : 'bg-trae-surface/40 text-trae-muted border-white/8 hover:border-white/15'
                      )}
                    >
                      <span className="font-bold">{h.name}</span>
                      <span className="text-trae-muted">{h.role}</span>
                      <span className={cn(
                        'font-mono',
                        winRate >= 50 ? 'text-trae-success' : 'text-trae-danger'
                      )}>
                        {winRate.toFixed(0)}%
                      </span>
                      <span className="text-trae-muted/60">({h.wins}/{h.total})</span>
                      {marketRate > 0 && (
                        <span className="text-[10px] text-trae-muted/40">
                          大盘{marketRate.toFixed(1)}%
                        </span>
                      )}
                    </button>
                  );
                })}
                {heroFilter !== 'ALL' && (
                  <button
                    onClick={() => setHeroFilter('ALL')}
                    className="inline-flex items-center px-2 py-1 rounded-lg text-[11px] text-trae-accent border border-trae-accent/20 hover:bg-trae-accent/10 transition-colors"
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
              <Filter className="w-3.5 h-3.5 text-trae-muted" />
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => setHeroFilter('ALL')}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors',
                    heroFilter === 'ALL'
                      ? 'bg-trae-primary/15 text-trae-primary-light border-trae-primary/30'
                      : 'bg-trae-surface/40 text-trae-muted border-white/8 hover:border-white/15'
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
                        ? 'bg-trae-accent/15 text-trae-accent border-trae-accent/30'
                        : 'bg-trae-surface/40 text-trae-muted border-white/8 hover:border-white/15'
                    )}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-trae-muted ml-auto">
                共 {filteredRecords.length} 条
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Records list */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl mx-auto space-y-3">
          {filteredRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-trae-surface/80 border border-white/8 flex items-center justify-center mb-3">
                <NotebookText className="w-6 h-6 text-trae-muted" />
              </div>
              <p className="text-sm font-medium text-trae-muted mb-1">暂无记录</p>
              <p className="text-[11px] text-trae-muted/60 max-w-xs">
                完成一次 BP 模拟后，在结果页点击「记录本次 BP」即可保存记录。
              </p>
            </div>
          ) : (
            filteredRecords.map((record) => (
              <RecordCard key={record.id} record={record} onDelete={deleteRecord} highlightHeroId={heroFilter !== 'ALL' ? heroFilter : undefined} />
            ))
          )}
        </div>
      </div>

      {/* Clear confirmation modal */}
      {showConfirmClear && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass rounded-2xl border border-white/10 p-5 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-trae-danger/15 border border-trae-danger/25 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-trae-danger" />
              </div>
              <h3 className="text-sm font-bold text-trae-text">确认清空</h3>
            </div>
            <p className="text-xs text-trae-muted mb-5 leading-relaxed">
              此操作将删除全部 {records.length} 条 BP 记录，且无法恢复。是否继续？
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowConfirmClear(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-trae-muted hover:text-trae-text hover:bg-white/5 border border-white/8 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  clearAll();
                  setShowConfirmClear(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-trae-danger/15 text-trae-danger border border-trae-danger/25 hover:bg-trae-danger/25 transition-colors"
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
    primary: 'from-trae-primary to-trae-accent text-trae-primary-light',
    success: 'from-trae-success to-emerald-400 text-trae-success',
    danger: 'from-trae-danger to-trae-warning text-trae-danger',
    warning: 'from-trae-warning to-amber-400 text-trae-warning',
  };

  return (
    <div className="relative p-3 rounded-xl bg-trae-surface/60 border border-white/8 text-center overflow-hidden">
      <div className={cn('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-60', colorMap[color].split(' ').slice(0, 2).join(' '))} />
      <div className="text-[11px] text-trae-muted mb-1">{label}</div>
      <div className={cn('text-xl font-display font-bold', colorMap[color].split(' ').slice(2).join(' '))}>
        {value}
      </div>
    </div>
  );
}
