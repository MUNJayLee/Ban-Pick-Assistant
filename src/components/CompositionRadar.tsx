import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { calculateCompositionScore, normalizeCompositionScore, getTeamHeroes } from '@/services/heroService';
import type { BpState, CompositionScore } from '@/types';

interface CompositionRadarProps {
  state: BpState;
}

const LABEL_MAP: Record<keyof CompositionScore, string> = {
  frontline: '前排',
  damage: '输出',
  control: '控制',
  sustain: '续航',
  mobility: '机动',
};

export function CompositionRadar({ state }: CompositionRadarProps) {
  const blue = getTeamHeroes(state, 'BLUE');
  const red = getTeamHeroes(state, 'RED');

  const blueScore = normalizeCompositionScore(calculateCompositionScore(blue));
  const redScore = normalizeCompositionScore(calculateCompositionScore(red));

  const data = (Object.keys(blueScore) as (keyof CompositionScore)[]).map(
    (key) => ({
      subject: LABEL_MAP[key],
      blue: Math.round(blueScore[key] * 100),
      red: Math.round(redScore[key] * 100),
      fullMark: 100,
    })
  );

  return (
    <div className="relative w-full h-64 glass rounded-2xl border border-white/8 p-3 overflow-hidden">
      <div className="absolute -bottom-20 -left-20 w-48 h-48 bg-trae-purple/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative text-xs font-bold text-trae-text mb-1 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-trae-primary to-trae-accent" />
        阵容维度对比
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
          <PolarGrid stroke="rgba(255,255,255,0.10)" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: '#94a3b8', fontSize: 10 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={false}
            axisLine={false}
          />
          <Radar
            name="蓝方"
            dataKey="blue"
            stroke="#3b82f6"
            fill="#3b82f6"
            fillOpacity={0.22}
          />
          <Radar
            name="红方"
            dataKey="red"
            stroke="#ef4444"
            fill="#ef4444"
            fillOpacity={0.18}
          />
          <Legend
            wrapperStyle={{ color: '#f8fafc', fontSize: '10px' }}
            verticalAlign="bottom"
            height={24}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
