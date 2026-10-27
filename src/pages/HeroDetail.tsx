import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Sword, Shield, Heart, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { HeroAvatar } from '@/components/HeroAvatar';
import { PositionBadge } from '@/components/PositionBadge';
import { getHeroById, getAllHeroes } from '@/services/heroService';
import { ROLE_LABELS } from '@/data/config';
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
            'text-ui-success': tone === 'positive',
            'text-ui-danger': tone === 'negative',
            'text-ui-warning': tone === 'neutral',
          })}
        />
        <h3 className="text-xs font-bold text-ui-text">{title}</h3>
      </div>
      {heroes.length === 0 ? (
        <p className="text-xs text-ui-muted">暂无相关数据</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {heroes.map((hero) => (
            <button
              key={hero.id}
              onClick={() => navigate(`/hero/${hero.id}`)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-ui-surface/70 border border-white/8 hover:border-ui-primary/40 transition-colors"
            >
              <HeroAvatar heroId={hero.id} size="sm" />
              <span className="text-xs text-ui-text">{hero.name}</span>
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
      <div className="min-h-screen flex flex-col items-center justify-center text-ui-text bg-ui-bg">
        <p className="text-ui-muted mb-4">未找到该英雄</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-ui-primary to-ui-accent text-white text-sm font-bold shadow-glow-blue"
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ui-bg text-ui-text">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 text-xs text-ui-muted hover:text-ui-primary transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          返回 BP 模拟
        </button>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl border border-white/8 p-6 relative overflow-hidden"
        >
          <div className="absolute -top-24 -right-24 w-56 h-56 bg-ui-primary/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-56 h-56 bg-ui-purple/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex items-start gap-4 mb-6 relative">
            <HeroAvatar heroId={hero.id} size="xl" ring />
            <div>
              <h1 className="text-2xl font-display font-bold text-ui-text">
                {hero.name}
              </h1>
              <p className="text-sm text-ui-primary-light mt-1">{hero.title}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {hero.positions && hero.positions.length > 0
                  ? hero.positions.map((pos) => (
                      <PositionBadge key={pos} position={pos} />
                    ))
                  : hero.positionLabel && (
                      <span className="text-xs text-ui-muted">{hero.positionLabel}</span>
                    )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 relative">
            <StatPill
              label="梯度评分"
              value={hero.tier ? `${hero.tier} · ${hero.tierScore?.toFixed(0) ?? '-'}` : '-'}
              highlight
            />
            <StatPill label="热度" value={hero.popularity.toFixed(1)} />
            <StatPill label="难度" value={`${hero.difficulty}/10`} />
            <StatPill label="定位" value={hero.roles.map((r) => ROLE_LABELS[r]).join('/')} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative">
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
            <RelationshipList
              title={`较差搭档 (${(hero.antiSynergies || []).length})`}
              heroIds={hero.antiSynergies || []}
              icon={AlertTriangle}
              tone="negative"
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
    <div className="p-3 rounded-xl bg-ui-surface/60 border border-white/8 text-center">
      <div className="text-xs text-ui-muted">{label}</div>
      <div
        className={cn(
          'text-lg font-bold mt-1',
          highlight ? 'text-ui-primary-light' : 'text-ui-text'
        )}
      >
        {value}
      </div>
    </div>
  );
}
