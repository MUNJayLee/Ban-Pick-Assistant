import { useMemo, useState } from 'react';
import { BarChart3, Swords, Sparkles, NotebookText } from 'lucide-react';
import { BpHeader } from '@/components/BpHeader';
import { BpStage } from '@/components/BpStage';
import { HeroPool } from '@/components/HeroPool';
import { RecommendationPanel } from '@/components/RecommendationPanel';
import { TurnIndicator } from '@/components/TurnIndicator';
import { AnalysisSummary } from '@/components/AnalysisSummary';
import { DataDashboard } from '@/components/DataDashboard';
import { BpRecords } from '@/components/BpRecords';
import { useBpStore } from '@/store/bpStore';
import { recommendHeroes } from '@/services/recommendationService';
import { PICK_SEQUENCE } from '@/data/config';
import { cn } from '@/lib/utils';
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
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (isTauri) {
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

  const hasAction = state.phase !== 'FINISHED';
  const operator = (() => {
    const op = state.getActiveOperator();
    if (!op) return null;
    return {
      name: op === 'ME' ? '我方' : '敌方',
      role: state.getPhaseLabel(),
    };
  })();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-trae-bg text-trae-text">
      {/* Top navigation */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 glass border-b border-white/5 z-50">
        <div className="flex items-center gap-3">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-trae-primary to-trae-accent flex items-center justify-center shadow-glow-blue">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/20 to-transparent" />
            <Sparkles className="w-4 h-4 text-white relative z-10" />
          </div>
          <div>
            <h1 className="text-base md:text-lg font-display text-white leading-tight">
              王者 BP 助手
            </h1>
            <p className="text-[11px] text-trae-muted font-medium tracking-wide">
              实时胜率 · 10 盲 Ban · AI 推荐
            </p>
          </div>
        </div>

        <div className="flex items-center bg-trae-surface rounded-xl p-1 border border-white/8 shadow-surface">
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
            canUndo={hasAction && state.phase !== 'MY_BAN'}
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
                <BpStage state={state} activeSide={activeSide} />

                {state.phase === 'MY_BAN' && (
                  <div className="mt-3 text-center animate-fade-in">
                    <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-trae-primary/10 border border-trae-primary/25 text-trae-primary-light shadow-glow-blue">
                      <span className="w-2 h-2 rounded-full bg-trae-primary animate-pulse" />
                      我方盲 Ban 阶段：请连续选择 5 个要禁用的英雄
                    </span>
                  </div>
                )}
                {state.phase === 'ENEMY_BAN' && (
                  <div className="mt-3 text-center animate-fade-in">
                    <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-trae-danger/10 border border-trae-danger/25 text-trae-danger shadow-glow-red">
                      <span className="w-2 h-2 rounded-full bg-trae-danger animate-pulse" />
                      敌方盲 Ban 阶段：请通过搜索/点击输入对方禁用的 5 个英雄
                    </span>
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

                <div className="w-full lg:w-80 flex-none h-auto lg:h-auto order-1 lg:order-2 border-b lg:border-b-0 lg:border-l border-white/5 bg-trae-surface/50">
                  <RecommendationPanel
                    recommendations={recommendations}
                    phase={state.phase}
                    isMyTurn={isMyTurn}
                    operator={operator}
                    onSelect={state.selectHero}
                  />
                </div>
              </section>
            )}
          </main>
        </>
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
          ? 'bg-gradient-to-r from-trae-primary to-trae-accent text-white shadow-glow-blue'
          : 'text-trae-muted hover:text-trae-text hover:bg-white/5'
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
