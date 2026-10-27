import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard,
  Target,
  CheckCircle2,
  XCircle,
  Users,
  ThumbsUp,
  ThumbsDown,
  ArrowLeft,
  RefreshCw,
  Lock,
} from 'lucide-react';
import { getSupabase, isCloudSyncEnabled } from '@/lib/supabase';
import { getHeroById } from '@/services/heroService';
import { cn } from '@/lib/utils';

const DASHBOARD_PASSWORD = import.meta.env.VITE_DASHBOARD_PASSWORD || 'bp2026';

interface BpRow {
  local_id: string;
  device_id: string;
  created_at: string;
  blue_picks: string[];
  red_picks: string[];
  blue_bans: string[];
  red_bans: string[];
  blue_power: number | null;
  red_power: number | null;
  favored: string | null;
  predicted_correct: boolean | null;
  actual_result: string | null;
  my_hero_id: string | null;
  my_side: string | null;
  my_role: string | null;
  note: string | null;
}

interface FeedbackRow {
  id: string;
  device_id: string;
  created_at: string;
  hero_id: string;
  phase: string;
  helpful: boolean;
}

function heroName(id: string): string {
  return getHeroById(id)?.name || id;
}

export function Dashboard() {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem('bp-dash-auth') === '1'
  );
  const [password, setPassword] = useState('');
  const [passErr, setPassErr] = useState(false);

  const [records, setRecords] = useState<BpRow[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cloudEnabled = isCloudSyncEnabled();

  const load = async () => {
    const sb = getSupabase();
    if (!sb) return;
    setLoading(true);
    setError(null);
    try {
      const [recRes, fbRes] = await Promise.all([
        sb.from('bp_records').select('*').order('created_at', { ascending: false }),
        sb.from('recommendation_feedback').select('*').order('created_at', { ascending: false }),
      ]);
      if (recRes.error) throw new Error(recRes.error.message);
      if (fbRes.error) throw new Error(fbRes.error.message);
      setRecords((recRes.data as BpRow[]) || []);
      setFeedback((fbRes.data as FeedbackRow[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authed && cloudEnabled) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, cloudEnabled]);

  const stats = useMemo(() => {
    const total = records.length;
    const decided = records.filter((r) => r.predicted_correct !== null && r.predicted_correct !== undefined);
    const correct = decided.filter((r) => r.predicted_correct === true).length;
    const devices = new Set(records.map((r) => r.device_id)).size;
    const fbTotal = feedback.length;
    const fbUp = feedback.filter((f) => f.helpful).length;
    return {
      total,
      decided: decided.length,
      correct,
      accuracy: decided.length > 0 ? correct / decided.length : 0,
      devices,
      fbTotal,
      fbUp,
      fbAccuracy: fbTotal > 0 ? fbUp / fbTotal : 0,
    };
  }, [records, feedback]);

  const heroStats = useMemo(() => {
    const map = new Map<
      string,
      { id: string; games: number; wins: number; correct: number; decided: number }
    >();
    for (const r of records) {
      if (!r.my_hero_id) continue;
      const cur =
        map.get(r.my_hero_id) ||
        { id: r.my_hero_id, games: 0, wins: 0, correct: 0, decided: 0 };
      cur.games += 1;
      if (r.actual_result === 'WIN') cur.wins += 1;
      if (r.predicted_correct !== null && r.predicted_correct !== undefined) {
        cur.decided += 1;
        if (r.predicted_correct) cur.correct += 1;
      }
      map.set(r.my_hero_id, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.games - a.games);
  }, [records]);

  const feedbackStats = useMemo(() => {
    const map = new Map<string, { id: string; up: number; down: number }>();
    for (const f of feedback) {
      const cur = map.get(f.hero_id) || { id: f.hero_id, up: 0, down: 0 };
      if (f.helpful) cur.up += 1;
      else cur.down += 1;
      map.set(f.hero_id, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.up + b.down - (a.up + a.down));
  }, [feedback]);

  const recent = records.slice(0, 10);

  // 密码门
  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ui-bg text-ui-text px-6">
        <div className="w-full max-w-sm glass rounded-2xl border border-white/8 p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-ui-primary to-ui-accent flex items-center justify-center shadow-glow-blue">
              <Lock className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-bold">云端数据看板</h1>
          </div>
          <p className="text-xs text-ui-muted mb-4">请输入访问密码查看测试数据汇总。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (password === DASHBOARD_PASSWORD) {
                sessionStorage.setItem('bp-dash-auth', '1');
                setAuthed(true);
              } else {
                setPassErr(true);
              }
            }}
            className="space-y-3"
          >
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPassErr(false);
              }}
              placeholder="访问密码"
              autoFocus
              className={cn(
                'w-full px-3 py-2 rounded-xl bg-ui-surface border text-sm text-ui-text placeholder:text-ui-muted focus:outline-none',
                passErr ? 'border-ui-danger/60' : 'border-white/8 focus:border-ui-primary/50'
              )}
            />
            {passErr && <p className="text-[11px] text-ui-danger">密码错误，请重试</p>}
            <button
              type="submit"
              className="w-full px-4 py-2 rounded-xl bg-gradient-to-r from-ui-primary to-ui-accent text-white text-sm font-bold shadow-glow-blue"
            >
              进入看板
            </button>
          </form>
          <Link to="/" className="flex items-center gap-1 text-[11px] text-ui-muted hover:text-ui-text mt-4">
            <ArrowLeft className="w-3 h-3" /> 返回 BP 模拟
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ui-bg text-ui-text">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-ui-primary to-ui-accent flex items-center justify-center shadow-glow-blue">
              <LayoutDashboard className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">云端数据看板</h1>
              <p className="text-[11px] text-ui-muted">朋友测试数据 · 实时汇总</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/8 text-xs text-ui-text hover:border-ui-primary/40 transition-colors"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              刷新
            </button>
            <Link
              to="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/8 text-xs text-ui-muted hover:text-ui-text transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              返回
            </Link>
          </div>
        </div>

        {!cloudEnabled && (
          <div className="mb-4 p-3 rounded-xl bg-ui-warning/10 border border-ui-warning/25 text-xs text-ui-warning">
            未配置 Supabase，无法读取云端数据。请先在部署环境设置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-ui-danger/10 border border-ui-danger/25 text-xs text-ui-danger">
            读取失败：{error}
          </div>
        )}

        {/* 概览卡片 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <StatCard icon={Target} label="总记录" value={String(stats.total)} color="primary" />
          <StatCard
            icon={CheckCircle2}
            label="预测正确率"
            value={`${(stats.accuracy * 100).toFixed(0)}%`}
            color="success"
            sub={`${stats.correct}/${stats.decided} 已判定`}
          />
          <StatCard icon={Users} label="测试人数" value={String(stats.devices)} color="warning" />
          <StatCard
            icon={ThumbsUp}
            label="推荐好评率"
            value={`${(stats.fbAccuracy * 100).toFixed(0)}%`}
            color="accent"
            sub={`${stats.fbUp}/${stats.fbTotal} 条反馈`}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
          {/* 英雄胜率统计 */}
          <Section title="我的英雄 · 实际胜率" icon={Target}>
            {heroStats.length === 0 ? (
              <Empty text="暂无数据，等朋友标记英雄并选择对局结果后出现" />
            ) : (
              <div className="space-y-1.5">
                {heroStats.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 text-xs">
                    <span className="w-20 truncate font-medium text-ui-text">{heroName(h.id)}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-ui-primary to-ui-accent"
                        style={{ width: `${h.games > 0 ? (h.wins / h.games) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-14 text-right font-mono text-ui-success">
                      {h.games > 0 ? `${((h.wins / h.games) * 100).toFixed(0)}%` : '-'}
                    </span>
                    <span className="w-20 text-right text-ui-muted">
                      预测{h.decided > 0 ? ` ${Math.round((h.correct / h.decided) * 100)}%` : '-'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 推荐反馈统计 */}
          <Section title="推荐反馈 · 准/不准" icon={ThumbsUp}>
            {feedbackStats.length === 0 ? (
              <Empty text="暂无反馈，朋友在推荐面板点 👍/👎 后出现" />
            ) : (
              <div className="space-y-1.5">
                {feedbackStats.map((f) => {
                  const total = f.up + f.down;
                  const rate = total > 0 ? f.up / total : 0;
                  return (
                    <div key={f.id} className="flex items-center gap-2 text-xs">
                      <span className="w-20 truncate font-medium text-ui-text">{heroName(f.id)}</span>
                      <div className="flex-1 flex items-center gap-1">
                        <ThumbsUp className="w-3 h-3 text-ui-success shrink-0" />
                        <span className="font-mono text-ui-success w-5">{f.up}</span>
                        <ThumbsDown className="w-3 h-3 text-ui-danger shrink-0 ml-1" />
                        <span className="font-mono text-ui-danger w-5">{f.down}</span>
                      </div>
                      <span className="w-12 text-right font-mono" style={{ color: rate >= 0.5 ? '#22c55e' : '#f59e0b' }}>
                        {Math.round(rate * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        {/* 最近记录 */}
        <Section title="最近记录" icon={LayoutDashboard}>
          {recent.length === 0 ? (
            <Empty text="暂无记录" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-ui-muted border-b border-white/5">
                  <tr>
                    <th className="py-2 pr-3 font-medium">时间</th>
                    <th className="py-2 pr-3 font-medium">蓝方</th>
                    <th className="py-2 pr-3 font-medium">红方</th>
                    <th className="py-2 pr-3 font-medium">预测</th>
                    <th className="py-2 font-medium">结果</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {recent.map((r) => (
                    <tr key={r.local_id}>
                      <td className="py-2 pr-3 text-ui-muted whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-2 pr-3 text-ui-text">
                        {r.blue_picks.map(heroName).join('、') || '-'}
                      </td>
                      <td className="py-2 pr-3 text-ui-text">
                        {r.red_picks.map(heroName).join('、') || '-'}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={cn(
                          'px-1.5 py-0.5 rounded-full text-[10px] font-bold',
                          r.predicted_correct === true
                            ? 'bg-ui-success/15 text-ui-success'
                            : r.predicted_correct === false
                            ? 'bg-ui-danger/15 text-ui-danger'
                            : 'bg-ui-warning/15 text-ui-warning'
                        )}>
                          {r.predicted_correct === true ? '对' : r.predicted_correct === false ? '错' : '待'}
                        </span>
                      </td>
                      <td className="py-2">
                        <span className={cn(
                          'font-medium',
                          r.actual_result === 'WIN' ? 'text-ui-success' : r.actual_result === 'LOSE' ? 'text-ui-danger' : 'text-ui-muted'
                        )}>
                          {r.actual_result === 'WIN' ? '赢' : r.actual_result === 'LOSE' ? '输' : '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: 'primary' | 'success' | 'warning' | 'accent';
  sub?: string;
}) {
  const colorMap = {
    primary: '#3b82f6',
    success: '#22c55e',
    warning: '#f59e0b',
    accent: '#06b6d4',
  };
  const hex = colorMap[color];
  return (
    <div className="glass rounded-xl border border-white/8 p-3 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: hex }} />
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-4 h-4" style={{ color: hex }} />
        <span className="text-[11px] text-ui-muted">{label}</span>
      </div>
      <div className="text-2xl font-display font-bold">{value}</div>
      {sub && <div className="text-[10px] text-ui-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-2xl border border-white/8 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-ui-primary-light" />
        <h3 className="text-sm font-bold text-ui-text">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-8 text-center text-xs text-ui-muted">{text}</div>;
}
