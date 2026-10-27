import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { HeroAvatar } from '@/components/HeroAvatar';
import { PositionBadge } from '@/components/PositionBadge';
import { getAllHeroes, getSelectableHeroIds } from '@/services/heroService';
import type { BpState, Hero } from '@/types';
import { cn } from '@/lib/utils';

interface HeroSearchProps {
  state: BpState;
  onSelect: (heroId: string) => void;
  placeholder?: string;
}

function normalizeSearch(text: string) {
  return text
    .toLowerCase()
    .replace(/[\s·•]/g, '')
    .trim();
}

export function HeroSearch({ state, onSelect, placeholder }: HeroSearchProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const heroes = getAllHeroes();
  const selectableIds = getSelectableHeroIds(state, state.phase, state.userSide);

  const matches = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return [];
    return heroes
      .filter((h) => !selectableIds.has(h.id))
      .filter((h) => {
        const name = normalizeSearch(h.name);
        const title = normalizeSearch(h.title);
        return name.includes(q) || title.includes(q) || h.id.includes(q);
      })
      .slice(0, 8);
  }, [heroes, selectableIds, query]);

  const showDropdown = query.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!showDropdown) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % matches.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const hero = matches[activeIndex];
        if (hero) {
          onSelect(hero.id);
          setQuery('');
          inputRef.current?.focus();
        }
      } else if (e.key === 'Escape') {
        setQuery('');
        inputRef.current?.blur();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showDropdown, matches, activeIndex, onSelect]);

  // 点击外部关闭下拉
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-4 h-4 text-ui-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder || '搜索英雄名称…'}
          className={cn(
            'w-full pl-9 pr-8 py-2 rounded-xl bg-ui-surface/70 border text-sm text-ui-text placeholder:text-ui-muted',
            'focus:outline-none focus:border-ui-primary/50 transition-colors'
          )}
          style={{ borderColor: showDropdown ? '#3b82f680' : 'rgba(255,255,255,0.08)' }}
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="absolute right-2 p-1 rounded-md hover:bg-ui-surface-elevated text-ui-muted transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto glass border border-white/10 rounded-xl shadow-surface-lg">
          {matches.length > 0 ? (
            matches.map((hero, idx) => (
              <button
                key={hero.id}
                onClick={() => {
                  onSelect(hero.id);
                  setQuery('');
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
                  idx === activeIndex ? 'bg-ui-surface-elevated/70' : 'hover:bg-ui-surface-elevated/40'
                )}
              >
                <HeroAvatar heroId={hero.id} size="sm" ring />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-ui-text truncate">
                      {hero.name}
                    </span>
                    {hero.positions && hero.positions.length > 0
                      ? hero.positions.slice(0, 1).map((pos) => (
                          <PositionBadge key={pos} position={pos} size="xs" />
                        ))
                      : hero.positionLabel && (
                          <span className="text-[9px] text-ui-muted">{hero.positionLabel}</span>
                        )}
                  </div>
                  <div className="text-[10px] text-ui-muted truncate">
                    {hero.title}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="px-3 py-4 text-center text-xs text-ui-muted">
              未找到匹配英雄
            </div>
          )}
        </div>
      )}
    </div>
  );
}
