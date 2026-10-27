import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { HeroCard } from '@/components/HeroCard';
import { getAllHeroes, getSelectableHeroIds } from '@/services/heroService';
import { ROLE_LABELS } from '@/data/config';
import type { HeroRole, HeroRecommendation, BpState } from '@/types';
import { cn } from '@/lib/utils';

type RoleFilter = HeroRole | 'ALL';

const ROLE_ORDER: RoleFilter[] = [
  'ALL',
  'TANK',
  'WARRIOR',
  'ASSASSIN',
  'MAGE',
  'MARKSMAN',
  'SUPPORT',
];

const FILTER_LABELS: Record<RoleFilter, string> = {
  ALL: '全部',
  ...ROLE_LABELS,
};

interface HeroPoolProps {
  state: BpState;
  recommendations: HeroRecommendation[];
  onSelect: (heroId: string) => void;
}

/**
 * 返回当前阶段在英雄池中应显示为"已禁用"的英雄 id 集合。
 * 盲 Ban 阶段只显示当前操作方的 ban，避免提前暴露对方 ban 位；
 * 选英雄阶段则显示双方全部 ban 位。
 */
function getVisibleBannedIds(state: BpState): Set<string> {
  if (state.phase === 'MY_BAN') {
    return new Set(state.userSide === 'BLUE' ? state.blueBans : state.redBans);
  }
  if (state.phase === 'ENEMY_BAN') {
    return new Set(state.userSide === 'BLUE' ? state.redBans : state.blueBans);
  }
  return new Set([...state.blueBans, ...state.redBans]);
}

export function HeroPool({ state, recommendations, onSelect }: HeroPoolProps) {
  const [filter, setFilter] = useState<RoleFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const heroes = getAllHeroes();
  const selectableIds = getSelectableHeroIds(state, state.phase, state.userSide);
  const visibleBannedIds = useMemo(() => getVisibleBannedIds(state), [state]);

  const recommendationsMap = useMemo(() => {
    const map = new Map<string, HeroRecommendation>();
    for (const rec of recommendations) {
      map.set(rec.heroId, rec);
    }
    return map;
  }, [recommendations]);

  const recommendationRankMap = useMemo(() => {
    const map = new Map<string, number>();
    recommendations.forEach((rec, index) => {
      map.set(rec.heroId, index + 1);
    });
    return map;
  }, [recommendations]);

  const filteredHeroes = useMemo(() => {
    return heroes.filter((hero) => {
      const matchesRole = filter === 'ALL' || hero.roles.includes(filter);
      const matchesSearch =
        searchQuery.trim() === '' ||
        hero.name.includes(searchQuery.trim()) ||
        (hero.title && hero.title.includes(searchQuery.trim()));
      return matchesRole && matchesSearch;
    });
  }, [heroes, filter, searchQuery]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex-none px-3 md:px-4 py-3 space-y-3 border-b border-white/5 bg-ui-bg-elevated/40">
        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ui-muted-subtle" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索英雄名称、称号快速选择…"
            className={cn(
              'w-full pl-9 pr-4 py-2 rounded-xl text-sm text-ui-text placeholder:text-ui-muted-subtle',
              'bg-ui-surface border border-white/8 focus:border-ui-primary/50 focus:ring-2 focus:ring-ui-primary/15 outline-none transition-all',
              'shadow-inner'
            )}
          />
        </div>

        {/* Role filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          {ROLE_ORDER.map((role) => (
            <button
              key={role}
              onClick={() => setFilter(role)}
              className={cn(
                'flex-none px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-200',
                filter === role
                  ? 'bg-ui-primary text-white border-ui-primary shadow-glow-blue'
                  : 'bg-ui-surface text-ui-muted border-white/8 hover:text-ui-text hover:bg-white/5'
              )}
            >
              {FILTER_LABELS[role]}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3 md:p-4">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2 md:gap-3">
          {filteredHeroes.map((hero, index) => {
            const disabled = selectableIds.has(hero.id);
            const rec = recommendationsMap.get(hero.id);
            const rank = rec ? recommendationRankMap.get(hero.id) : undefined;
            return (
              <HeroCard
                key={hero.id}
                hero={hero}
                recommendation={rec}
                rank={rank}
                disabled={disabled}
                banned={visibleBannedIds.has(hero.id)}
                selected={state.bluePicks.includes(hero.id) || state.redPicks.includes(hero.id)}
                onClick={() => onSelect(hero.id)}
                style={{ animationDelay: `${Math.min(index * 15, 300)}ms` }}
              />
            );
          })}
        </div>

        {filteredHeroes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-ui-muted">
            <div className="w-12 h-12 rounded-2xl bg-ui-surface border border-white/8 flex items-center justify-center mb-3">
              <Search className="w-5 h-5 text-ui-muted-subtle" />
            </div>
            <p className="text-sm">未找到匹配的英雄</p>
          </div>
        )}
      </div>
    </div>
  );
}
