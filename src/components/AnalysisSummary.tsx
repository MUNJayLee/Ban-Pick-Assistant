import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Trophy,
  AlertTriangle,
  TrendingUp,
  Zap,
  CheckCircle2,
  XCircle,
  BookmarkPlus,
  NotebookPen,
  User,
  Crown,
  Skull,
  Clock,
  Info,
} from 'lucide-react';
import { CompositionRadar } from '@/components/CompositionRadar';
import { getTeamHeroes, getHeroById, calculateTeamStrength, calculateWinProbability } from '@/services/heroService';
import { useBpRecordStore, autoJudgeResult } from '@/store/bpRecordStore';
import { useBpStore } from '@/store/bpStore';
import { cn } from '@/lib/utils';
import type { BpState, Side, ActualResult, BpRecordResult } from '@/types';

interface AnalysisSummaryProps {
  state: BpState;
}

export function AnalysisSummary({ state }: AnalysisSummaryProps) {
  const bluePower = useMemo(() => calculateTeamStrength(state, 'BLUE'), [state]);
  const redPower = useMemo(() => calculateTeamStrength(state, 'RED'), [state]);
  const difference = bluePower - redPower;
  const blueWinProb = useMemo(
    () => calculateWinProbability(bluePower, redPower),
    [bluePower, redPower]
  );
  const favored: Side | 'EVEN' =
    Math.abs(difference) < 1
      ? 'EVEN'
      : difference > 0
      ? 'BLUE'
      : 'RED';

  const { records, addRecord, updateRecord } = useBpRecordStore();
  const { myHeroId, setMyHero } = useBpStore();
  const [note, setNote] = useState('');
  const [actualResult, setActualResult] = useState<ActualResult>('PENDING');
  const [rating, setRating] = useState<string>('');
  const [isMvp, setIsMvp] = useState(false);
  const [medal, setMedal] = useState<'GOLD' | 'SILVER' | 'BRONZE' | undefined>(undefined);
  const draftCreated = useRef(false);

  const existingRecord = useMemo(
    () =>
      records.find(
        (r) =>
          r.bluePicks.join(',') === state.bluePicks.join(',') &&
          r.redPicks.join(',') === state.redPicks.join(',')
      ),
    [records, state]
  );

  // 当已有记录时，从记录中恢复 actualResult 状态
  useEffect(() => {
    if (existingRecord) {
      setActualResult(existingRecord.actualResult ?? 'PENDING');
      setRating(existingRecord.rating != null ? String(existingRecord.rating) : '');
      setIsMvp(!!existingRecord.isMvp);
      setMedal(existingRecord.medal);
    }
  }, [existingRecord?.id]);

  // ADB 识别到 BP 完成后自动建一条草稿记录（只建一次，避免重复）
  useEffect(() => {
    if (
      state.phase === 'FINISHED' &&
      !existingRecord &&
      !draftCreated.current &&
      state.bluePicks.filter(Boolean).length === 5 &&
      state.redPicks.filter(Boolean).length === 5
    ) {
      draftCreated.current = true;
      addRecord(buildRecordPayload('PENDING'));
    }
  }, [state.phase, existingRecord]);

  const myHero = myHeroId ? getHeroById(myHeroId) : undefined;
  const mySide: Side | undefined = myHeroId
    ? state.bluePicks.includes(myHeroId)
      ? 'BLUE'
      : state.redPicks.includes(myHeroId)
      ? 'RED'
      : undefined
    : undefined;

  const buildRecordPayload = (
    result: BpRecordResult,
    actual: ActualResult = actualResult
  ) => ({
    timestamp: Date.now(),
    bluePicks: [...state.bluePicks],
    redPicks: [...state.redPicks],
    blueBans: [...state.blueBans],
    redBans: [...state.redBans],
    bluePower,
    redPower,
    favored,
    result,
    myHeroId: myHeroId || undefined,
    mySide,
    myRole: myHero?.roles[0],
    actualResult: actual === 'PENDING' ? undefined : actual,
    rating: rating.trim() === '' ? undefined : Number(rating),
    isMvp: isMvp || undefined,
    medal: medal,
    note: note || undefined,
  });

  const handleSaveRecord = () => {
    addRecord(buildRecordPayload('PENDING'));
  };

  /**
   * 选择对局结果后自动闭环：
   * 1. 设置 actualResult
   * 2. 根据 favored + mySide + actualResult 自动判定预测正确与否
   * 3. 自动创建或更新记录
   */
  const handleActualResultChange = (result: ActualResult) => {
    setActualResult(result);

    const judged = autoJudgeResult(favored, mySide, result);
    const payload = buildRecordPayload(judged, result);

    if (existingRecord) {
      updateRecord(existingRecord.id, payload);
    } else {
      addRecord(payload);
    }
  };

  // 自动判定的结果（用于 UI 展示）
  const autoJudgedResult: BpRecordResult | null =
    actualResult !== 'PENDING' && mySide && favored !== 'EVEN'
      ? autoJudgeResult(favored, mySide, actualResult)
      : null;

  const allPicks = [
    ...state.bluePicks.map((id) => ({ id, side: 'BLUE' as Side })),
    ...state.redPicks.map((id) => ({ id, side: 'RED' as Side })),
  ];
  // 我方已选优先展示（确认「我的英雄」时避免在双方 10 个里找错）
  const userSidePicks = allPicks.filter((p) => p.side === state.userSide);
  const enemySidePicks = allPicks.filter((p) => p.side !== state.userSide);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 animate-fade-in">
      {/* Lineup analysis */}
      <div className="glass rounded-2xl border border-white/8 p-4 overflow-hidden relative">
        <div className="absolute -top-16 -right-16 w-40 h-40 bg-ui-primary/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center gap-2 mb-4 relative">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-ui-primary to-ui-accent flex items-center justify-center shadow-glow-blue">
            <Trophy className="w-4 h-4 text-white" />
          </div>
          <h3 className="text-sm font-bold text-ui-text">阵容分析</h3>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4 relative">
          <PowerCard label="蓝方综合评分" value={bluePower} color="primary" />
          <PowerCard label="红方综合评分" value={redPower} color="danger" />
        </div>

        {/* 标记"我"的英雄 — 醒目提示 */}
        {allPicks.length > 0 && (
          <div className={cn(
            'mb-4 rounded-2xl border p-4 transition-all',
            myHero
              ? 'bg-gradient-to-br from-ui-accent/8 to-ui-primary/5 border-ui-accent/25 shadow-lg shadow-ui-accent/5'
              : 'bg-gradient-to-br from-amber-500/8 to-orange-500/5 border-amber-400/30 shadow-lg shadow-amber-500/5 animate-pulse-subtle'
          )}>
            <div className="flex items-center gap-2.5 mb-3">
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center',
                myHero
                  ? 'bg-ui-accent/20 shadow-glow-accent'
                  : 'bg-amber-500/20'
              )}>
                <User className={cn(
                  'w-4 h-4',
                  myHero ? 'text-ui-accent' : 'text-amber-400'
                )} />
              </div>
              <div className="flex-1">
                <span className={cn(
                  'text-sm font-bold',
                  myHero ? 'text-ui-accent' : 'text-amber-300'
                )}>
                  {myHero ? '已标记我的英雄' : '选择你本局使用的英雄'}
                </span>
                {!myHero && (
                  <p className="text-[10px] text-amber-400/70 mt-0.5">标记后可自动追踪个人胜率与大盘对比</p>
                )}
              </div>
              {myHero && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-ui-accent/10 border border-ui-accent/20">
                  <Crown className="w-3.5 h-3.5 text-ui-accent" />
                  <span className="text-xs font-bold text-ui-accent">{myHero.name}</span>
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded-md',
                    mySide === 'BLUE'
                      ? 'bg-ui-primary/20 text-ui-primary-light'
                      : 'bg-ui-danger/20 text-ui-danger-light'
                  )}>
                    {mySide === 'BLUE' ? '蓝方' : '红方'}
                  </span>
                </div>
              )}
            </div>
            {userSidePicks.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] text-ui-muted/80 mb-1.5">
                  我方（{state.userSide === 'BLUE' ? '蓝方' : '红方'}）已选 · 点一下确认你的英雄
                </p>
                <div className="flex flex-wrap gap-2">
                  {userSidePicks.map(({ id }) => {
                    const hero = getHeroById(id);
                    const isMe = myHeroId === id;
                    return (
                      <button
                        key={id}
                        onClick={() => setMyHero(isMe ? undefined : id)}
                        className={cn(
                          'relative inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all',
                          isMe
                            ? 'bg-ui-accent/25 text-ui-accent border-ui-accent/50 shadow-md shadow-ui-accent/10 scale-105 ring-2 ring-ui-accent/30'
                            : 'bg-ui-primary/10 text-ui-primary-light/80 border-ui-primary/20 hover:bg-ui-primary/20 hover:border-ui-primary/40 hover:scale-105',
                        )}
                      >
                        {isMe && (
                          <>
                            <Crown className="w-3.5 h-3.5 text-ui-accent" />
                            <span className="absolute -top-1 -right-1 w-3 h-3 bg-ui-accent rounded-full border border-white/30" />
                          </>
                        )}
                        {hero?.name || id}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {enemySidePicks.length > 0 && (
              <details className="mt-1">
                <summary className="text-[10px] text-ui-muted/70 cursor-pointer hover:text-ui-muted select-none">
                  敌方已选（点错阵营时用）
                </summary>
                <div className="flex flex-wrap gap-2 mt-2">
                  {enemySidePicks.map(({ id }) => {
                    const hero = getHeroById(id);
                    const isMe = myHeroId === id;
                    return (
                      <button
                        key={id}
                        onClick={() => setMyHero(isMe ? undefined : id)}
                        className={cn(
                          'relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all',
                          isMe
                            ? 'bg-ui-accent/25 text-ui-accent border-ui-accent/50 ring-2 ring-ui-accent/30'
                            : 'bg-ui-danger/10 text-ui-danger-light/70 border-ui-danger/15 hover:bg-ui-danger/20 hover:border-ui-danger/30',
                        )}
                      >
                        {isMe && <Crown className="w-3.5 h-3.5" />}
                        {hero?.name || id}
                      </button>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        )}

        <div className="p-3 rounded-xl bg-ui-surface/60 border border-white/8 relative">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-ui-warning" />
            <span className="text-xs font-bold text-ui-text">胜率预估</span>
          </div>

          {/* 胜率条 */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold text-ui-primary-light">
              蓝方 {(blueWinProb * 100).toFixed(0)}%
            </span>
            <div className="flex-1 h-2 rounded-full overflow-hidden bg-ui-danger/20">
              <div
                className="h-full rounded-full bg-gradient-to-r from-ui-primary to-ui-accent"
                style={{ width: `${Math.min(100, Math.max(0, blueWinProb * 100))}%` }}
              />
            </div>
            <span className="text-sm font-bold text-ui-danger-light">
              红方 {((1 - blueWinProb) * 100).toFixed(0)}%
            </span>
          </div>

          <p className="text-xs text-ui-muted leading-relaxed">
            {favored === 'EVEN'
              ? '双方阵容强度接近，胜负更多取决于操作与配合。'
              : favored === 'BLUE'
              ? `蓝方阵容综合评分领先 ${Math.abs(difference).toFixed(1)} 分，前中期节奏与团战容错率较高。`
              : `红方阵容综合评分领先 ${Math.abs(difference).toFixed(1)} 分，在中后期团战与关键点位上更具威胁。`}
          </p>
        </div>
      </div>

      <CompositionRadar state={state} />

      {/* Record action */}
      <div className="lg:col-span-2">
        <div className="glass rounded-2xl border border-white/8 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-ui-success to-emerald-400 flex items-center justify-center shadow-glow-green">
              <NotebookPen className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-sm font-bold text-ui-text">记录实际结果</h3>
            {existingRecord && (
              <span
                className={cn(
                  'ml-auto text-xs font-bold px-2 py-0.5 rounded-full',
                  existingRecord.result === 'CORRECT'
                    ? 'bg-ui-success/15 text-ui-success border border-ui-success/25'
                    : existingRecord.result === 'INCORRECT'
                    ? 'bg-ui-danger/15 text-ui-danger border border-ui-danger/25'
                    : 'bg-ui-warning/15 text-ui-warning border border-ui-warning/25'
                )}
              >
                {existingRecord.result === 'CORRECT'
                  ? '预测正确'
                  : existingRecord.result === 'INCORRECT'
                  ? '预测错误'
                  : '待对局'}
              </span>
            )}
          </div>

          {/* 预测倾向提示 */}
          {favored !== 'EVEN' && (
            <div className="mb-3 p-2 rounded-xl bg-ui-surface/40 border border-white/8 flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-ui-accent flex-shrink-0" />
              <span className="text-[11px] text-ui-muted">
                系统预测 <span className={cn('font-bold', favored === 'BLUE' ? 'text-ui-primary-light' : 'text-ui-danger-light')}>{favored === 'BLUE' ? '蓝方' : '红方'}</span> 阵容优势（领先 {Math.abs(difference).toFixed(1)} 分）。选择对局结果后将自动判定预测是否正确。
              </span>
            </div>
          )}

          {/* 我赢了/输了 — 选择后自动闭环 */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] text-ui-muted flex-shrink-0">我的对局结果：</span>
            <div className="flex gap-1.5">
              {(['WIN', 'LOSE', 'PENDING'] as ActualResult[]).map((r) => (
                <button
                  key={r}
                  onClick={() => handleActualResultChange(r)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors',
                    actualResult === r
                      ? r === 'WIN'
                        ? 'bg-ui-primary/20 text-ui-primary-light border-ui-primary/40'
                        : r === 'LOSE'
                        ? 'bg-ui-danger/20 text-ui-danger-light border-ui-danger/40'
                        : 'bg-ui-warning/15 text-ui-warning border-ui-warning/30'
                      : 'bg-ui-surface/40 text-ui-muted border-white/8 hover:border-white/15'
                  )}
                >
                  {r === 'WIN' && <Crown className="w-3 h-3" />}
                  {r === 'LOSE' && <Skull className="w-3 h-3" />}
                  {r === 'PENDING' && <Clock className="w-3 h-3" />}
                  {r === 'WIN' ? '我赢了' : r === 'LOSE' ? '我输了' : '未结束'}
                </button>
              ))}
            </div>
          </div>

          {/* 对局评分 / MVP / 奖牌（精细复盘） */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[11px] text-ui-muted flex-shrink-0">对局评分：</span>
            <input
              type="number"
              min={0}
              max={16}
              step={0.1}
              value={rating}
              placeholder="如 12.5"
              onChange={(e) => {
                const v = e.target.value;
                setRating(v);
                if (existingRecord) {
                  const num = v.trim() === '' ? undefined : Number(v);
                  updateRecord(existingRecord.id, { rating: num });
                }
              }}
              className="w-20 px-2 py-1 rounded-lg bg-ui-surface/60 border border-white/10 text-xs text-ui-text outline-none focus:border-ui-primary/40"
            />
            <button
              onClick={() => {
                const next = !isMvp;
                setIsMvp(next);
                if (existingRecord) updateRecord(existingRecord.id, { isMvp: next || undefined });
              }}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors',
                isMvp
                  ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                  : 'bg-ui-surface/40 text-ui-muted border-white/8 hover:border-white/15'
              )}
            >
              MVP
            </button>
            {(['GOLD', 'SILVER', 'BRONZE'] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  const next = medal === m ? undefined : m;
                  setMedal(next);
                  if (existingRecord) updateRecord(existingRecord.id, { medal: next });
                }}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors',
                  medal === m
                    ? m === 'GOLD'
                      ? 'bg-yellow-500/20 text-yellow-300 border-yellow-400/40'
                      : m === 'SILVER'
                      ? 'bg-slate-400/20 text-slate-200 border-slate-300/40'
                      : 'bg-orange-700/20 text-orange-300 border-orange-500/40'
                    : 'bg-ui-surface/40 text-ui-muted border-white/8 hover:border-white/15'
                )}
              >
                {m === 'GOLD' ? '金牌' : m === 'SILVER' ? '银牌' : '铜牌'}
              </button>
            ))}
          </div>

          {/* 自动判定结果展示 */}
          {autoJudgedResult && (
            <div className={cn(
              'mb-3 p-3 rounded-xl border flex items-center gap-2 animate-fade-in',
              autoJudgedResult === 'CORRECT'
                ? 'bg-ui-success/10 border-ui-success/25'
                : 'bg-ui-danger/10 border-ui-danger/25'
            )}>
              {autoJudgedResult === 'CORRECT' ? (
                <CheckCircle2 className="w-4 h-4 text-ui-success flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-ui-danger flex-shrink-0" />
              )}
              <div className="flex-1">
                <span className={cn(
                  'text-xs font-bold',
                  autoJudgedResult === 'CORRECT' ? 'text-ui-success' : 'text-ui-danger'
                )}>
                  {autoJudgedResult === 'CORRECT' ? '预测正确！' : '预测错误'}
                </span>
                <span className="text-[11px] text-ui-muted ml-2">
                  预测{favored === 'BLUE' ? '蓝方' : '红方'}优势，你在{mySide === 'BLUE' ? '蓝方' : '红方'}，结果{actualResult === 'WIN' ? '赢了' : '输了'}
                </span>
              </div>
            </div>
          )}

          {/* 提示信息 */}
          {actualResult !== 'PENDING' && !autoJudgedResult && (
            <div className="mb-3 p-2 rounded-xl bg-ui-warning/10 border border-ui-warning/20 flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-ui-warning flex-shrink-0" />
              <span className="text-[11px] text-ui-warning">
                {!mySide
                  ? '请先标记你使用的英雄，才能自动判定预测正确与否'
                  : '双方阵容接近，无明确预测倾向，不参与判定'}
              </span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="可选：添加备注（如对局模式、段位等）"
              className="flex-1 px-3 py-2 rounded-xl bg-ui-surface/60 border border-white/8 text-xs text-ui-text placeholder:text-ui-muted focus:outline-none focus:border-ui-primary/40 transition-colors"
            />
            <div className="flex gap-2 flex-shrink-0">
              {!existingRecord && actualResult === 'PENDING' && (
                <button
                  onClick={handleSaveRecord}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-ui-primary/15 border border-ui-primary/25 text-ui-primary-light text-xs font-semibold hover:bg-ui-primary/25 transition-colors"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  记录本次 BP
                </button>
              )}
              {existingRecord && actualResult === 'PENDING' && (
                <span className="text-[11px] text-ui-muted px-4 py-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  对局结束后选择结果即可自动记录
                </span>
              )}
              {actualResult !== 'PENDING' && (
                <span className="text-[11px] text-ui-success px-4 py-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  已自动记录
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Key highlights */}
      <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-3">
        <HighlightCard
          title="蓝方核心优势"
          heroes={getTeamHeroes(state, 'BLUE')}
          side="BLUE"
        />
        <HighlightCard
          title="红方核心优势"
          heroes={getTeamHeroes(state, 'RED')}
          side="RED"
        />
        <div className="p-4 rounded-2xl bg-ui-surface/60 border border-white/8 flex items-start gap-3">
          <div className="w-7 h-7 rounded-lg bg-ui-warning/10 border border-ui-warning/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-ui-warning" />
          </div>
          <div>
            <div className="text-xs font-bold text-ui-text mb-1">数据说明</div>
            <p className="text-[11px] text-ui-muted leading-relaxed">
              以上评分基于当前版本 AI 胜率、英雄克制关系与阵容维度进行模拟计算，仅供参考。实际对局受选手操作、版本微调与团队配合影响较大。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PowerCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'primary' | 'danger';
}) {
  const gradient =
    color === 'primary'
      ? 'from-ui-primary to-ui-accent'
      : 'from-ui-danger to-ui-warning';
  const glow = color === 'primary' ? 'shadow-glow-blue' : 'shadow-glow-red';

  return (
    <div className="relative p-3 rounded-xl bg-ui-surface/60 border border-white/8 text-center overflow-hidden group">
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-60',
          gradient
        )}
      />
      <div className="text-xs text-ui-muted">{label}</div>
      <div
        className={cn(
          'text-2xl font-display font-bold mt-1 bg-gradient-to-r bg-clip-text text-transparent',
          gradient,
          glow
        )}
      >
        {value.toFixed(1)}
      </div>
    </div>
  );
}

function HighlightCard({
  title,
  heroes,
  side,
}: {
  title: string;
  heroes: ReturnType<typeof getTeamHeroes>;
  side: Side;
}) {
  const best = useMemo(
    () =>
      heroes.length > 0
        ? heroes.reduce((max, h) => (h.aiWinRate > max.aiWinRate ? h : max), heroes[0])
        : null,
    [heroes]
  );

  return (
    <div className="p-4 rounded-2xl bg-ui-surface/60 border border-white/8">
      <div className="flex items-center gap-2 mb-2">
        <Zap
          className={cn(
            'w-4 h-4',
            side === 'BLUE' ? 'text-ui-primary' : 'text-ui-danger'
          )}
        />
        <span className="text-xs font-bold text-ui-text">{title}</span>
      </div>
      {best ? (
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-ui-text truncate pr-2">
            {best.name}
          </div>
          <div className="text-xs font-mono text-ui-success">
            {(best.aiWinRate * 100).toFixed(1)}%
          </div>
        </div>
      ) : (
        <div className="text-xs text-ui-muted">暂无英雄数据</div>
      )}
    </div>
  );
}

