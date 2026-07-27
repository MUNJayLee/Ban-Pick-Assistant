import { useMemo, useState } from 'react';
import { ArrowUpRight, ArrowDownRight, Minus, RefreshCw, BarChart3, ShieldAlert, MousePointer, Flame } from 'lucide-react';
import { motion } from 'framer-motion';
import { HeroAvatar } from '@/components/HeroAvatar';
import { PositionBadge } from '@/components/PositionBadge';
import { getAllHeroes } from '@/services/heroService';
import { cn } from '@/lib/utils';
import type { Hero, HeroPosition } from '@/types';
import { POSITION_LABELS } from '@/types';

const POSITIONS: HeroPosition[] = [
  'CLASH_LANE',
  'MID_LANE',
  'FARM_LANE',
  'JUNGLE',
  'ROAM',
];

const POSITION_COLORS: Record<HeroPosition, string> = {
  CLASH_LANE: '#f59e0b',
  MID_LANE: '#a855f7',
  FARM_LANE: '#ef4444',
  JUNGLE: '#22c55e',
  ROAM: '#3b82f6',
};

type SortKey = 'aiWinRate' | 'popularity' | 'pickRate' | 'banRate';

interface DataDashboardProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
  lastUpdated?: string;
}

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function getTrendIcon(current?: number, baseline = 0.5) {
  if (current === undefined) return <Minus className="w-3 h-3 text-trae-muted" />;
  if (current > baseline + 0.02) return <ArrowUpRight className="w-3 h-3 text-trae-success" />;
  if (current < baseline - 0.02) return <ArrowDownRight className="w-3 h-3 text-trae-danger" />;
  return <Minus className="w-3 h-3 text-trae-muted" />;
}

export function DataDashboard({
  onRefresh,
  isRefreshing,
  lastUpdated,
}: DataDashboardProps) {
  const [filter, setFilter] = useState<HeroPosition | 'ALL'>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('aiWinRate');
  const [sortDesc, setSortDesc] = useState(true);

  const heroes = getAllHeroes();

  const stats = useMemo(() => {
    const list = heroes.filter((h) => (filter === 'ALL' ? true : h.positions?.includes(filter)));
    const total = list.length || 1;
    return {
      avgWinRate: list.reduce((s, h) => s + h.aiWinRate, 0) / total,
      avgPickRate: list.reduce((s, h) => s + (h.pickRate || 0), 0) / total,
      avgBanRate: list.reduce((s, h) => s + (h.banRate || 0), 0) / total,
      count: list.length,
    };
  }, [heroes, filter]);

  const sortedHeroes = useMemo(() => {
    const list = heroes.filter((h) => (filter === 'ALL' ? true : h.positions?.includes(filter)));
    return [...list].sort((a, b) => {
      const aVal = a[sortKey] ?? 0;
      const bVal = b[sortKey] ?? 0;
      return sortDesc ? bVal - aVal : aVal - bVal;
    });
  }, [heroes, filter, sortKey, sortDesc]);

  const topPick = useMemo(
    () => [...heroes].sort((a, b) => (b.pickRate || 0) - (a.pickRate || 0))[0],
    [heroes]
  );
  const topBan = useMemo(
    () => [...heroes].sort((a, b) => (b.banRate || 0) - (a.banRate || 0))[0],
    [heroes]
  );
  const topWin = useMemo(
    () => [...heroes].sort((a, b) => b.aiWinRate - a.aiWinRate)[0],
    [heroes]
  );

  const SortButton = ({
    keyName,
    label,
    icon: Icon,
  }: {
    keyName: SortKey;
    label: string;
    icon: React.ElementType;
  }) => (
    <button
      onClick={() => {
        if (sortKey === keyName) setSortDesc(!sortDesc);
        else {
          setSortKey(keyName);
          setSortDesc(true);
        }
      }}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200',
        sortKey === keyName
          ? 'bg-gradient-to-r from-trae-primary to-trae-accent text-white border-transparent shadow-glow-blue'
          : 'bg-trae-surface text-trae-muted border-white/8 hover:border-trae-primary/40 hover:text-trae-text'
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {sortKey === keyName && (sortDesc ? '↓' : '↑')}
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-trae-bg text-trae-text">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 glass border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-trae-primary to-trae-accent flex items-center justify-center shadow-glow-blue">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base md:text-lg font-display font-bold leading-tight">
              实时胜率数据看板
            </h1>
            <p className="text-[10px] text-trae-muted">
              {lastUpdated ? `上次更新：${lastUpdated}` : '点击右上角刷新获取最新数据'}
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200',
            isRefreshing
              ? 'bg-trae-surface border-white/8 text-trae-muted cursor-not-allowed'
              : 'bg-trae-surface border-white/8 text-trae-text hover:border-trae-primary/40'
          )}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
          {isRefreshing ? '更新中…' : '立即刷新'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl mx-auto space-y-4">
          {/* Top cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="平均胜率"
              value={formatPercent(stats.avgWinRate)}
              icon={BarChart3}
              trend={getTrendIcon(stats.avgWinRate, 0.5)}
              color="trae-success"
            />
            <StatCard
              label="平均登场率"
              value={formatPercent(stats.avgPickRate)}
              icon={MousePointer}
              trend={getTrendIcon(stats.avgPickRate, 0.1)}
              color="trae-primary"
            />
            <StatCard
              label="平均禁用率"
              value={formatPercent(stats.avgBanRate)}
              icon={ShieldAlert}
              trend={getTrendIcon(stats.avgBanRate, 0.05)}
              color="trae-danger"
            />
            <StatCard
              label="统计英雄"
              value={String(stats.count)}
              icon={Flame}
              color="trae-warning"
            />
          </div>

          {/* Champions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ChampionCard hero={topWin} title="胜率之王" metric="aiWinRate" color="trae-success" />
            <ChampionCard hero={topPick} title="登场之王" metric="pickRate" color="trae-primary" />
            <ChampionCard hero={topBan} title="禁用之王" metric="banRate" color="trae-danger" />
          </div>

          {/* Filters */}
          <div className="glass rounded-xl border border-white/8 p-3">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs text-trae-muted">分路筛选</span>
              <button
                onClick={() => setFilter('ALL')}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium border transition-all duration-200',
                  filter === 'ALL'
                    ? 'bg-gradient-to-r from-trae-primary to-trae-accent text-white border-transparent shadow-glow-blue'
                    : 'bg-trae-bg text-trae-muted border-white/8 hover:border-trae-primary/40 hover:text-trae-text'
                )}
              >
                全部
              </button>
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  onClick={() => setFilter(pos)}
                  className="px-3 py-1 rounded-full text-xs font-medium border transition-all duration-200"
                  style={
                    filter === pos
                      ? {
                          backgroundColor: POSITION_COLORS[pos],
                          color: '#fff',
                          borderColor: POSITION_COLORS[pos],
                        }
                      : {
                          backgroundColor: `${POSITION_COLORS[pos]}15`,
                          color: POSITION_COLORS[pos],
                          borderColor: `${POSITION_COLORS[pos]}33`,
                        }
                  }
                >
                  {POSITION_LABELS[pos]}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-trae-muted">排序</span>
              <SortButton keyName="aiWinRate" label="胜率" icon={BarChart3} />
              <SortButton keyName="pickRate" label="登场率" icon={MousePointer} />
              <SortButton keyName="banRate" label="禁用率" icon={ShieldAlert} />
              <SortButton keyName="popularity" label="热度" icon={Flame} />
            </div>
          </div>

          {/* Table */}
          <div className="glass rounded-xl border border-white/8 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-trae-surface/70 text-trae-muted text-xs">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">英雄</th>
                    <th className="px-3 py-2.5 font-medium">定位</th>
                    <th className="px-3 py-2.5 font-medium text-right">胜率</th>
                    <th className="px-3 py-2.5 font-medium text-right">登场率</th>
                    <th className="px-3 py-2.5 font-medium text-right">禁用率</th>
                    <th className="px-3 py-2.5 font-medium text-right">热度</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {sortedHeroes.map((hero, idx) => (
                    <motion.tr
                      key={hero.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.015 }}
                      className="hover:bg-trae-surface/40 transition-colors"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <HeroAvatar heroId={hero.id} size="sm" />
                          <span className="font-medium text-trae-text">{hero.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {hero.positions && hero.positions.length > 0
                            ? hero.positions.map((pos) => (
                                <PositionBadge key={pos} position={pos} size="xs" />
                              ))
                            : hero.positionLabel && (
                                <span className="text-[9px] text-trae-muted">{hero.positionLabel}</span>
                              )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <RateValue value={hero.aiWinRate} baseline={0.5} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <RateValue value={hero.pickRate} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <RateValue value={hero.banRate} />
                      </td>
                      <td className="px-3 py-2 text-right text-trae-text">
                        {hero.popularity.toFixed(1)}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sortedHeroes.length === 0 && (
              <div className="p-8 text-center text-trae-muted text-xs">
                暂无数据，请先刷新获取实时胜率。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  color,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  trend?: React.ReactNode;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    'trae-success': '#22c55e',
    'trae-primary': '#3b82f6',
    'trae-danger': '#ef4444',
    'trae-warning': '#f59e0b',
  };
  const hex = colorMap[color] || '#94a3b8';

  return (
    <div className="glass rounded-xl border border-white/8 p-3 relative overflow-hidden group hover:border-white/12 transition-colors">
      <div
        className="absolute inset-x-0 top-0 h-0.5 opacity-60"
        style={{ backgroundColor: hex }}
      />
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color: hex }} />
        <span className="text-xs text-trae-muted">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xl font-display font-bold text-trae-text">{value}</span>
        {trend}
      </div>
    </div>
  );
}

function ChampionCard({
  hero,
  title,
  metric,
  color,
}: {
  hero?: Hero;
  title: string;
  metric: 'aiWinRate' | 'pickRate' | 'banRate';
  color: string;
}) {
  if (!hero) return null;
  const value = hero[metric];
  const labels: Record<typeof metric, string> = {
    aiWinRate: '胜率',
    pickRate: '登场率',
    banRate: '禁用率',
  };

  const colorMap: Record<string, string> = {
    'trae-success': '#22c55e',
    'trae-primary': '#3b82f6',
    'trae-danger': '#ef4444',
  };
  const hex = colorMap[color] || '#94a3b8';

  return (
    <div className="glass rounded-xl border border-white/8 p-3 flex items-center gap-3 hover:border-white/12 transition-colors">
      <HeroAvatar heroId={hero.id} size="lg" ring />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-trae-muted uppercase tracking-wider">{title}</div>
        <div className="text-base font-bold text-trae-text truncate">{hero.name}</div>
        <div className="flex items-center gap-2 mt-1">
          {hero.positions && hero.positions.length > 0
            ? hero.positions.slice(0, 2).map((pos) => (
                <PositionBadge key={pos} position={pos} size="xs" />
              ))
            : hero.positionLabel && (
                <span className="text-[9px] text-trae-muted">{hero.positionLabel}</span>
              )}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xl font-display font-bold" style={{ color: hex }}>
          {formatPercent(value)}
        </div>
        <div className="text-[10px] text-trae-muted">{labels[metric]}</div>
      </div>
    </div>
  );
}

function RateValue({ value, baseline }: { value?: number; baseline?: number }) {
  if (value === undefined || Number.isNaN(value)) {
    return <span className="text-trae-muted">-</span>;
  }
  const display = (value * 100).toFixed(1);
  let color = '#94a3b8';
  if (baseline !== undefined) {
    color = value >= baseline + 0.02 ? '#22c55e' : value <= baseline - 0.02 ? '#ef4444' : '#f59e0b';
  }
  return (
    <span className="font-medium tabular-nums" style={{ color }}>
      {display}%
    </span>
  );
}
