// 全链路测试：截图识别(bans) -> importBans -> 10 轮 PICK 推荐 -> 阵容强度/胜率
// 运行：npx tsx scripts/full_chain_test.ts
import { readFileSync } from 'node:fs';
import { setHeroesData, calculateTeamStrength, calculateWinProbability, getAllHeroes, getHeroById } from '@/services/heroService';
import { recommendHeroes } from '@/services/recommendation';
import { PICK_SEQUENCE } from '@/data/config';
import type { BpState, Side } from '@/types';

function main() {
  const data = JSON.parse(readFileSync('src/data/heroes.json', 'utf-8'));
  setHeroesData(data);
  const heroes = getAllHeroes();
  console.log('1. 英雄数据加载:', heroes.length, '位\n');

  // 截图识别得到的 10 个 ban（Python 参照版 10/10 的结果）
  const blueBans = ['xiangyu', 'yixing', 'cang', 'yuanliuzhizi_support', 'niumo'];
  const redBans = ['lixin', 'yunzhongjun', 'cang', 'zhugeliang', 'caocao'];
  console.log('2. 截图识别 Ban 位（导入）:');
  console.log('   蓝方:', blueBans.map((id) => getHeroById(id)?.name ?? id).join('、'));
  console.log('   红方:', redBans.map((id) => getHeroById(id)?.name ?? id).join('、'));

  // importBans 后的状态
  const state: BpState = {
    userSide: 'BLUE',
    blueBans,
    redBans,
    bluePicks: [],
    redPicks: [],
    phase: 'PICK',
    pickTurnIndex: 0,
  };
  console.log('   -> phase=PICK, pickTurnIndex=0 ✓\n');

  // 模拟 10 轮选人
  console.log('3. 10 轮 PICK 模拟（每轮取推荐第 1 名）:');
  for (let i = 0; i < PICK_SEQUENCE.length; i++) {
    const turn = PICK_SEQUENCE[i];
    const side: Side = turn.side;
    const recs = recommendHeroes(state, side, 'PICK');
    if (recs.length === 0) {
      console.log(`   第${i + 1}轮 ${turn.description}: 无可选英雄！`);
      break;
    }
    const top = recs[0];
    const picked = top.heroId;
    if (side === 'BLUE') state.bluePicks = [...state.bluePicks, picked];
    else state.redPicks = [...state.redPicks, picked];
    state.pickTurnIndex = i + 1;
    console.log(
      `   第${i + 1}轮 ${turn.description} -> 选【${getHeroById(picked)?.name}】分${top.score.toFixed(1)} (${top.reason})`
    );
  }

  // 最终评分
  const bluePower = calculateTeamStrength(state, 'BLUE');
  const redPower = calculateTeamStrength(state, 'RED');
  const blueWin = calculateWinProbability(bluePower, redPower);
  console.log('\n4. 阵容强度与胜率:');
  console.log('   蓝方阵容:', state.bluePicks.map((id) => getHeroById(id)?.name).join('、'));
  console.log('   红方阵容:', state.redPicks.map((id) => getHeroById(id)?.name).join('、'));
  console.log(`   蓝方强度: ${bluePower.toFixed(1)}  红方强度: ${redPower.toFixed(1)}`);
  console.log(`   蓝方胜率: ${(blueWin * 100).toFixed(1)}%  红方胜率: ${((1 - blueWin) * 100).toFixed(1)}%`);

  const favored = Math.abs(bluePower - redPower) < 2 ? 'EVEN' : bluePower > redPower ? 'BLUE' : 'RED';
  console.log(`   预测占优: ${favored}\n`);

  console.log('5. 生成 BpRecord（供云端回传）:');
  console.log(JSON.stringify({
    blueBans: state.blueBans,
    redBans: state.redBans,
    bluePicks: state.bluePicks,
    redPicks: state.redPicks,
    bluePower: Math.round(bluePower * 10) / 10,
    redPower: Math.round(redPower * 10) / 10,
    favored,
  }, null, 2));
}

main();
