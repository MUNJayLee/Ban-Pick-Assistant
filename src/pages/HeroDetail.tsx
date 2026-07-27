import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Sword, Shield, Heart } from 'lucide-react';
import { motion } from 'framer-motion';
import { HeroAvatar } from '@/components/HeroAvatar';
import { PositionBadge } from '@/components/PositionBadge';
import { getHeroById, getAllHeroes } from '@/services/heroService';
import { cn } from '@/lib/utils';

function RelationshipList({
  title,
  heroIds,
  icon: Icon,
  tone,
}: {
  title: string;
  heroIds: string[];
  icon: React.ElementType;
  tone: 'positive' | 'negative' | 'neutral';
}) {
  const heroes = useMemo(() => getAllHeroes().filter((h) => heroIds.includes(h.id)), [heroIds]);
  const navigate = useNavigate();

  return (
    <div className="glass rounded-xl border border-white/8 p-3 relative overflow-hidden">
      <div className="flex items-center gap-2 mb-2">
        <Icon
          className={cn('w-4 h-4', {
            'text-trae-success': tone === 'positive',
            'text-trae-danger': tone === 'negative',
            'text-trae-warning': tone === 'neutral',
          })}
        />
        <h3 className="text-xs font-bold text-trae-text">{title}</h3>
      </div>
      {heroes.length === 0 ? (
        <p className="text-xs text-trae-muted">暂无相关数据</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {heroes.map((hero) => (
            <button
              key={hero.id}
              onClick={() => navigate(`/hero/${hero.id}`)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-trae-surface/70 border border-white/8 hover:border-trae-primary/40 transition-colors"
            >
              <HeroAvatar heroId={hero.id} size="sm" />
              <span className="text-xs text-trae-text">{hero.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HeroDetail() {
  const { heroId } = useParams<{ heroId: string }>();
  const navigate = useNavigate();
  const hero = useMemo(() => getHeroById(heroId || ''), [heroId]);

  if (!hero) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-trae-text bg-trae-bg">
        <p className="text-trae-muted mb-4">未找到该英雄</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-trae-primary to-trae-accent text-white text-sm font-bold shadow-glow-blue"
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-trae-bg text-trae-text">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 text-xs text-trae-muted hover:text-trae-primary transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          返回 BP 模拟
        </button>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl border border-white/8 p-6 relative overflow-hidden"
        >
          <div className="absolute -top-24 -right-24 w-56 h-56 bg-trae-primary/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-56 h-56 bg-trae-purple/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex items-start gap-4 mb-6 relative">
            <HeroAvatar heroId={hero.id} size="xl" ring />
            <div>
              <h1 className="text-2xl font-display font-bold text-trae-text">
                {hero.name}
              </h1>
              <p className="text-sm text-trae-primary-light mt-1">{hero.title}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {hero.positions && hero.positions.length > 0
                  ? hero.positions.map((pos) => (
                      <PositionBadge key={pos} position={pos} />
                    ))
                  : hero.positionLabel && (
                      <span className="text-xs text-trae-muted">{hero.positionLabel}</span>
                    )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 relative">
            <StatPill label="AI 胜率" value={`${(hero.aiWinRate * 100).toFixed(1)}%`} highlight />
            <StatPill label="热度" value={hero.popularity.toFixed(1)} />
            <StatPill label="难度" value={`${hero.difficulty}/10`} />
            <StatPill label="定位" value={hero.roles[0]} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 relative">
            <RelationshipList
              title={`克制 (${hero.counters.length})`}
              heroIds={hero.counters}
              icon={Sword}
              tone="positive"
            />
            <RelationshipList
              title={`被克制 (${hero.counteredBy.length})`}
              heroIds={hero.counteredBy}
              icon={Shield}
              tone="negative"
            />
            <RelationshipList
              title={`搭档 (${hero.synergies.length})`}
              heroIds={hero.synergies}
              icon={Heart}
              tone="neutral"
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="p-3 rounded-xl bg-trae-surface/60 border border-white/8 text-center">
      <div className="text-xs text-trae-muted">{label}</div>
      <div
        className={cn(
          'text-lg font-bold mt-1',
          highlight ? 'text-trae-primary-light' : 'text-trae-text'
        )}
      >
        {value}
      </div>
    </div>
  );
}
