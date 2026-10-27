import { useMemo, useState } from 'react';
import { BarChart3, Swords, Sparkles, NotebookText, ScanLine, X, Ban } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import { BpHeader } from '@/components/BpHeader';
import { ScreenshotImport } from '@/components/ScreenshotImport';
import { BpStage } from '@/components/BpStage';
import { HeroPool } from '@/components/HeroPool';
import { RecommendationPanel } from '@/components/RecommendationPanel';
import { TurnIndicator } from '@/components/TurnIndicator';
import { AnalysisSummary } from '@/components/AnalysisSummary';
import { DataDashboard } from '@/components/DataDashboard';
import { BpRecords } from '@/components/BpRecords';
import { useBpStore } from '@/store/bpStore';
import { recommendHeroes } from '@/services/recommendationService';
import { calculateTeamStrength, calculateWinProbability, getAllHeroes, getHeroById } from '@/services/heroService';
import { PICK_SEQUENCE } from '@/data/config';
import { cn, isTauri } from '@/lib/utils';
import { invoke } from '@tauri-apps/api/core';
import type { Side, BpState } from '@/types';

type Tab = 'bp' | 'data' | 'records';

function getActiveSideFromState(state: BpState): Side | null {
  if (state.phase === 'MY_BAN') return state.userSide;
  if (state.phase === 'ENEMY_BAN') return state.userSide === 'BLUE' ? 'RED' : 'BLUE';
  if (state.phase === 'PICK') {
    const turn = PICK_SEQUENCE[state.pickTurnIndex];
    return turn ? turn.side : null;
  }
  return null;
}

export function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('bp');
  const [showImport, setShowImport] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editingSlot, setEditingSlot] = useState<{ side: Side; kind: 'ban' | 'pick'; index: number } | null>(null);
  const [slotQuery, setSlotQuery] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string>(() => {
    try {
      return new Date().toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  });

  const state = useBpStore();
  const activeSide = getActiveSideFromState(state);
  const isMyTurn = state.isMyTurn();

  const allHeroes = useMemo(() => getAllHeroes(), []);
  const pinyinMap = useMemo(() => {
    const map = new Map<string, { py: string; ini: string }>();
    for (const h of allHeroes) {
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
  }, [allHeroes]);

  const slotMatches = useMemo(() => {
    const q = slotQuery.trim().toLowerCase();
    if (!q) return allHeroes.slice(0, 20);
    return allHeroes
      .filter((h) => {
        const p = pinyinMap.get(h.id);
        return (
          h.name.includes(slotQuery.trim()) ||
          h.id.includes(q) ||
          (p ? p.py.includes(q) || p.ini.includes(q) : false)
        );
      })
      .slice(0, 20);
  }, [allHeroes, pinyinMap, slotQuery]);

  function assignSlot(heroId: string) {
    if (!editingSlot) return;
    if (editingSlot.kind === 'ban') {
      state.setBanAt(editingSlot.side, editingSlot.index, heroId);
    } else {
      state.setPickAt(editingSlot.side, editingSlot.index, heroId);
    }
    setEditingSlot(null);
    setSlotQuery('');
  }

  function clearSlot() {
    if (!editingSlot) return;
    if (editingSlot.kind === 'ban') {
      state.setBanAt(editingSlot.side, editingSlot.index, '');
    } else {
      state.setPickAt(editingSlot.side, editingSlot.index, '');
    }
    setEditingSlot(null);
    setSlotQuery('');
  }

  const bluePower = useMemo(() => calculateTeamStrength(state, 'BLUE'), [state]);
  const redPower = useMemo(() => calculateTeamStrength(state, 'RED'), [state]);
  const blueWinProb = useMemo(() => calculateWinProbability(bluePower, redPower), [bluePower, redPower]);

  const mySide = state.userSide;
  const enemySide = mySide === 'BLUE' ? 'RED' : 'BLUE';
  const myBans = state[mySide === 'BLUE' ? 'blueBans' : 'redBans'];
  const enemyBans = state[enemySide === 'BLUE' ? 'blueBans' : 'redBans'];

  const recommendations = (() => {
    if (state.phase === 'MY_BAN') {
      return recommendHeroes(state, mySide, 'BAN');
    }
    if (state.phase === 'ENEMY_BAN') {
      return [];
    }
    if (state.phase === 'PICK' && isMyTurn) {
      return recommendHeroes(state, mySide, 'PICK');
    }
    return [];
  })();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (isTauri()) {
        await invoke<string>('fetch_data');
      } else {
        const res = await fetch('/api/fetch-data', { method: 'POST' });
        const result = await res.json();
        if (!res.ok || !result.success) {
          throw new Error(result.error || '刷新失败');
        }
      }
      setLastUpdated(
        new Date().toLocaleString('zh-CN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      );
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('刷新数据失败：', err);
      alert(`刷新数据失败：${message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const operator = (() => {
    const op = state.getActiveOperator();
    if (!op) return null;
    return {
      name: op === 'ME' ? '我方' : '敌方',
      role: state.getPhaseLabel(),
    };
  })();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-ui-bg text-ui-text">
      {/* Top navigation */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 glass border-b border-white/5 z-50">
        <div className="flex items-center gap-3">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-ui-primary to-ui-accent flex items-center justify-center shadow-glow-blue">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/20 to-transparent" />
            <Sparkles className="w-4 h-4 text-white relative z-10" />
          </div>
          <div>
            <h1 className="text-base md:text-lg font-display text-white leading-tight">
              王者 BP 助手
            </h1>
            <p className="text-[11px] text-ui-muted font-medium tracking-wide">
              实时胜率 · 10 盲 Ban · AI 推荐
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-ui-primary/30 text-ui-primary-light bg-ui-primary/10 hover:bg-ui-primary/20 transition-colors"
          >
            <ScanLine className="w-3.5 h-3.5" />
            截图导入
          </button>
          <div className="flex items-center bg-ui-surface rounded-xl p-1 border border-white/8 shadow-surface">
          <TabButton
            active={activeTab === 'bp'}
            onClick={() => setActiveTab('bp')}
            icon={Swords}
            label="BP 模拟"
          />
          <TabButton
            active={activeTab === 'data'}
            onClick={() => setActiveTab('data')}
            icon={BarChart3}
            label="数据看板"
          />
          <TabButton
            active={activeTab === 'records'}
            onClick={() => setActiveTab('records')}
            icon={NotebookText}
            label="记录"
          />
          </div>
        </div>
      </div>

      {activeTab === 'data' ? (
        <DataDashboard
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          lastUpdated={lastUpdated}
        />
      ) : activeTab === 'records' ? (
        <BpRecords />
      ) : (
        <>
          <BpHeader
            userSide={state.userSide}
            onSideChange={state.setUserSide}
            onReset={state.reset}
            onUndo={state.undo}
            canUndo={
              state.blueBans.length +
                state.redBans.length +
                state.bluePicks.length +
                state.redPicks.length >
              0
            }
          />

          <main className="flex-1 flex flex-col min-h-0">
            <section className="flex-none p-3 md:p-4 border-b border-white/5">
              <div className="max-w-6xl mx-auto">
                <div className="flex justify-center mb-3">
                  <TurnIndicator
                    phase={state.phase}
                    activeSide={activeSide}
                    phaseLabel={state.getPhaseLabel()}
                    isMyTurn={isMyTurn}
                    myBanCount={myBans.length}
                    enemyBanCount={enemyBans.length}
                    pickTurnIndex={state.pickTurnIndex}
                    totalPicks={PICK_SEQUENCE.length}
                  />
                </div>
                <BpStage
                  state={state}
                  activeSide={activeSide}
                  onSlotClick={(side, kind, index) => { setEditingSlot({ side, kind, index }); setSlotQuery(''); }}
                />

                {/* 实时胜率预估 */}
                {state.phase !== 'FINISHED' &&
                  state.bluePicks.length + state.redPicks.length > 0 && (
                    <div className="mt-3 flex items-center justify-center gap-3 text-xs animate-fade-in">
                      <span className="font-bold text-ui-primary-light">
                        蓝 {Math.round(blueWinProb * 100)}%
                      </span>
                      <div className="w-48 h-1.5 rounded-full overflow-hidden bg-ui-danger/20">
                        <div
                          className="h-full bg-gradient-to-r from-ui-primary to-ui-accent transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(0, blueWinProb * 100))}%` }}
                        />
                      </div>
                      <span className="font-bold text-ui-danger-light">
                        红 {Math.round((1 - blueWinProb) * 100)}%
                      </span>
                      <span className="text-ui-muted">实时胜率预估</span>
                    </div>
                  )}

                {state.phase === 'MY_BAN' && (
                  <div className="mt-3 flex items-center justify-center gap-3 animate-fade-in flex-wrap">
                    <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-ui-primary/10 border border-ui-primary/25 text-ui-primary-light shadow-glow-blue">
                      <span className="w-2 h-2 rounded-full bg-ui-primary animate-pulse" />
                      我方盲 Ban：选择 0-5 个要禁用的英雄，未选的空位视为「空 Ban」
                    </span>
                    <button
                      onClick={state.skipBan}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold border border-white/15 text-ui-muted hover:text-ui-text hover:border-white/30 transition-colors"
                    >
                      完成我方 Ban（跳过剩余）
                    </button>
                  </div>
                )}
                {state.phase === 'ENEMY_BAN' && (
                  <div className="mt-3 flex items-center justify-center gap-3 animate-fade-in flex-wrap">
                    <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-ui-danger/10 border border-ui-danger/25 text-ui-danger shadow-glow-red">
                      <span className="w-2 h-2 rounded-full bg-ui-danger animate-pulse" />
                      敌方盲 Ban：输入 0-5 个禁用的英雄，未选的空位视为「空 Ban」
                    </span>
                    <button
                      onClick={state.skipBan}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold border border-white/15 text-ui-muted hover:text-ui-text hover:border-white/30 transition-colors"
                    >
                      完成敌方 Ban（跳过剩余）
                    </button>
                  </div>
                )}
              </div>
            </section>

            {state.phase === 'FINISHED' ? (
              <section className="flex-1 overflow-y-auto">
                <AnalysisSummary state={state} />
              </section>
            ) : (
              <section className="flex-1 flex flex-col lg:flex-row min-h-0">
                <div className="flex-1 min-h-0 order-2 lg:order-1">
                  <HeroPool
                    state={state}
                    recommendations={recommendations}
                    onSelect={state.selectHero}
                  />
                </div>

                <div className="w-full lg:w-80 flex-none h-auto lg:h-auto order-1 lg:order-2 border-b lg:border-b-0 lg:border-l border-white/5 bg-ui-surface/50">
                  <RecommendationPanel
                    recommendations={recommendations}
                    phase={state.phase}
                    isMyTurn={isMyTurn}
                    operator={operator}
                    onSelect={state.selectHero}
                    state={state}
                  />
                </div>
              </section>
            )}
          </main>
        </>
      )}

      {showImport && <ScreenshotImport onClose={() => setShowImport(false)} />}

      {/* 手动指定槽位弹层 */}
      {editingSlot && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setEditingSlot(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-ui-bg-elevated p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold">
                {editingSlot.side === 'BLUE' ? '蓝方' : '红方'} ·{' '}
                {editingSlot.kind === 'ban' ? 'Ban' : 'Pick'} 第 {editingSlot.index + 1} 位
              </h3>
              <button onClick={() => setEditingSlot(null)} className="p-1 rounded-lg hover:bg-white/5 text-ui-muted">
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              autoFocus
              value={slotQuery}
              onChange={(e) => setSlotQuery(e.target.value)}
              placeholder="输入名字 / 拼音 / 首字母…"
              className="w-full px-3 py-2 rounded-lg bg-ui-surface border border-white/8 text-sm text-ui-text placeholder:text-ui-muted focus:outline-none focus:border-ui-primary/50"
            />

            <div className="flex flex-wrap gap-1.5 mt-3 max-h-48 overflow-y-auto">
              {slotMatches.map((h) => (
                <button
                  key={h.id}
                  onClick={() => assignSlot(h.id)}
                  className="px-2.5 py-1 rounded-lg text-xs bg-ui-surface border border-white/8 hover:border-ui-primary/40 transition-colors"
                >
                  {h.name}
                </button>
              ))}
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={clearSlot}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-ui-danger border border-ui-danger/30 hover:bg-ui-danger/10 transition-colors"
              >
                <Ban className="w-3.5 h-3.5" />
                清空此位（空 ban）
              </button>
              <button
                onClick={() => setEditingSlot(null)}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold border border-white/10 text-ui-muted hover:text-ui-text transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200',
        active
          ? 'bg-gradient-to-r from-ui-primary to-ui-accent text-white shadow-glow-blue'
          : 'text-ui-muted hover:text-ui-text hover:bg-white/5'
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
