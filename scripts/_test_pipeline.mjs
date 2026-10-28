// -*- coding: utf-8 -*-
// 流程链路测试：数据流一致性 / 状态机 / 数据污染（"吕布"类问题）
// 运行: node scripts/_test_pipeline.mjs
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';

const OUT = '_diag/_bundle';
mkdirSync(OUT, { recursive: true });

// ---------- 1. 打包 store 到 ESM ----------
console.log('[1/3] 打包 store...');
await build({
  entryPoints: { bpStore: 'src/store/bpStore.ts', bpRecordStore: 'src/store/bpRecordStore.ts' },
  bundle: true,
  format: 'esm',
  outdir: OUT,
  platform: 'node',
  external: ['react'],
  logLevel: 'error',
  // Vite 环境变量在 Node 里不存在，替换为空串（Supabase 同步会被跳过）
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '""',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'false',
    'import.meta.env.MODE': '"test"',
  },
});

// ---------- 2. mock window + localStorage ----------
// zustand persist 用的是 window.localStorage（不是全局 localStorage）
const store = {};
const mockStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
  removeItem: (k) => {
    delete store[k];
  },
  clear: () => {
    Object.keys(store).forEach((k) => delete store[k]);
  },
};
globalThis.localStorage = mockStorage;
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {};
}
globalThis.window.localStorage = mockStorage;

console.log('[2/3] localStorage mock:', typeof globalThis.localStorage);
// ---------- 3. 导入 store ----------
const { useBpStore } = await import(pathToFileURL(`${OUT}/bpStore.js`).href);
const { useBpRecordStore } = await import(pathToFileURL(`${OUT}/bpRecordStore.js`).href);

// ---------- 测试框架 ----------
const RESULTS = [];
function check(caseName, item, expected, actual) {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  RESULTS.push({ case: caseName, item, expected, actual, pass });
  if (!pass) console.log(`  [FAIL] ${caseName} ${item}: expect=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  return pass;
}
function section(t) {
  console.log(`\n--- ${t} ---`);
}
const bp = () => useBpStore.getState();
const rec = () => useBpRecordStore.getState();

const HERO = {
  A: 'lianpo', B: 'shangguanwaner', C: 'aoyin', D: 'jixiaoman', E: 'bailixuance',
  F: 'yixing', G: 'chijia', H: 'dayu', I: 'yuange', J: 'lubandashi',
};

// =====================================================================
// A. 状态机链路：初始 → 填 ban/pick → 切阵营 → 重置 → 新一局
// =====================================================================
section('A. 状态机链路（我的英雄/阵营切换/重置）');

bp().reset();
check('A1', '初始化', { bans: 0, picks: 0, side: 'BLUE' },
  { bans: bp().blueBans.filter(Boolean).length + bp().redBans.filter(Boolean).length,
    picks: bp().bluePicks.filter(Boolean).length + bp().redPicks.filter(Boolean).length,
    side: bp().userSide });

// 填 3 个蓝 ban
bp().setBanAt('BLUE', 0, HERO.A);
bp().setBanAt('BLUE', 2, HERO.B);
bp().setBanAt('BLUE', 4, HERO.C);
check('A2', '蓝方 ban 写入位置', [HERO.A, '', HERO.B, '', HERO.C],
  [bp().blueBans[0], bp().blueBans[1], bp().blueBans[2], bp().blueBans[3], bp().blueBans[4]]);

// 填 pick
bp().setPickAt('BLUE', 0, HERO.D);
bp().setPickAt('BLUE', 1, HERO.E);
bp().setPickAt('RED', 0, HERO.F);
bp().setPickAt('RED', 1, HERO.G);
check('A3', '双方向 pick', { blue: [HERO.D, HERO.E], red: [HERO.F, HERO.G] },
  { blue: bp().bluePicks.slice(0, 2), red: bp().redPicks.slice(0, 2) });

// 切阵营：数据必须保留
bp().setUserSide('BLUE');
bp().setMyHero(HERO.D);
const snapBefore = { bans: [...bp().blueBans], picks: [...bp().bluePicks], my: bp().myHeroId };
bp().setUserSide('RED');
check('A4', '切阵营后数据保留', snapBefore,
  { bans: [...bp().blueBans], picks: [...bp().bluePicks], my: bp().myHeroId });

// reset 全清
bp().reset();
check('A5', 'reset 全清（myHeroId 必须清空）', { bans: 0, picks: 0, my: undefined, side: 'BLUE', phase: 'MY_BAN' },
  { bans: bp().blueBans.filter(Boolean).length + bp().redBans.filter(Boolean).length,
    picks: bp().bluePicks.filter(Boolean).length + bp().redPicks.filter(Boolean).length,
    my: bp().myHeroId, side: bp().userSide, phase: bp().phase });

// =====================================================================
// B. 数据污染检测（"吕布"类问题）
// =====================================================================
section('B. 数据污染（myHeroId 不在阵容 / 同队重复）');

bp().reset();
bp().setPickAt('BLUE', 0, HERO.A);
bp().setPickAt('BLUE', 1, HERO.B);
bp().setMyHero('lubu'); // 吕布不在阵容
const pollution = {
  inRoster: [HERO.A, HERO.B].includes(bp().myHeroId),
  myHeroId: bp().myHeroId,
};
check('B1', 'myHeroId 不在阵容时仍被写入（store 层无校验）', false, pollution.inRoster);
console.log(`      → store 层不校验，依赖 useBpSync/记录层校验。myHeroId=${pollution.myHeroId}`);

// 同队重复检测（recognize_picks 已去重，但 store 层仍可能被手动写重复）
bp().reset();
bp().setPickAt('BLUE', 0, HERO.A);
bp().setPickAt('BLUE', 1, HERO.A); // 重复
const blue = bp().bluePicks.filter(Boolean);
check('B2', 'store 允许同队重复写入（无校验）', [HERO.A, HERO.A], blue);
console.log('      → 同队重复依赖 recognize_picks 去重 + 手动操作时 UI 是否允许');

// =====================================================================
// C. 记录链路：建记录 → 更新结果 → 编辑 → 统计
// =====================================================================
section('C. 记录链路（建记录/更新/编辑/统计）');

rec().clearAll();
const record = rec().addRecord({
  bluePicks: [HERO.A, HERO.B, HERO.C, HERO.D, HERO.E],
  redPicks: [HERO.F, HERO.G, HERO.H, HERO.I, HERO.J],
  blueBans: ['haiyue', 'zhangliang', 'yunying', 'zhenji', 'shaosiyuan'],
  redBans: ['nawa', 'zhuangzhou', 'donghuangtaiyi', 'chengyaojin', 'sunbin'],
  bluePower: 50,
  redPower: 49.2,
  favored: 'EVEN',
  result: 'PENDING',
  actualResult: 'PENDING',
  myHeroId: HERO.A,
  myRole: 'TANK',
});

check('C1', '建记录成功', 1, rec().records.length);
check('C2', '记录字段完整', true,
  !!(record.bluePicks?.length === 5 && record.redPicks?.length === 5 && record.myHeroId));

// 更新实际结果
rec().updateActualResult(record.id, 'WIN');
check('C3', '更新实际结果', 'WIN', rec().records[0].actualResult);

// 编辑（模拟 RecordEditModal 的 updateRecord）
rec().updateRecord(record.id, {
  bluePicks: [HERO.B, HERO.C, HERO.D, HERO.E, HERO.J],
  myHeroId: HERO.B,
  rating: 12.5,
  isMvp: true,
  medal: 'GOLD',
  note: '测试编辑',
});
const edited = rec().records[0];
check('C4', '编辑 picks', [HERO.B, HERO.C, HERO.D, HERO.E, HERO.J], edited.bluePicks);
check('C5', '编辑 myHeroId', HERO.B, edited.myHeroId);
check('C6', '编辑评分', { rating: 12.5, isMvp: true, medal: 'GOLD', note: '测试编辑' },
  { rating: edited.rating, isMvp: edited.isMvp, medal: edited.medal, note: edited.note });

// 统计
const stats = rec().getStats();
check('C7', '统计正确（预测=PENDING → pending=1）', { total: 1, correct: 0, pending: 1 },
  { total: stats.total, correct: stats.correct, pending: stats.pending });

// 删除
rec().deleteRecord(record.id);
check('C8', '删除记录', 0, rec().records.length);

// =====================================================================
// D. 持久化（localStorage 序列化/恢复）
// =====================================================================
section('D. 持久化（localStorage）');

rec().clearAll();
rec().addRecord({
  bluePicks: [HERO.A], redPicks: [HERO.F],
  blueBans: [], redBans: [],
  bluePower: 50, redPower: 50, favored: 'EVEN',
  result: 'PENDING', actualResult: 'PENDING',
  myHeroId: HERO.A,
});
const raw = store['bp-records-v1'] || null;
let parsed = null;
try {
  parsed = raw ? JSON.parse(raw) : null;
} catch {
  parsed = null;
}
check('D1', '记录已持久化到 localStorage', true, !!parsed?.state?.records?.length);
check('D2', '持久化格式（version）', true, parsed?.version === 1);

// =====================================================================
// E. 边界：myHeroId 校验逻辑（模拟 useBpSync 的校验）
// =====================================================================
section('E. myHeroId 校验逻辑（模拟 useBpSync）');

function validateMyHero(myHeroId, userSide, bluePicks, redPicks) {
  const myPicks = userSide === 'BLUE' ? bluePicks : redPicks;
  if (!myHeroId) return { action: 'none' };
  if (myPicks.length > 0 && !myPicks.includes(myHeroId)) {
    return { action: 'clear', reason: '不在我方阵容' };
  }
  return { action: 'keep' };
}

check('E1', '吕布不在蓝方 → 清理', { action: 'clear', reason: '不在我方阵容' },
  validateMyHero('lubu', 'BLUE', [HERO.A, HERO.B], [HERO.F]));
check('E2', '在蓝方 → 保留', { action: 'keep' },
  validateMyHero(HERO.A, 'BLUE', [HERO.A, HERO.B], [HERO.F]));
check('E3', '我方 picks 为空 → 不清理（等数据）', { action: 'keep' },
  validateMyHero('lubu', 'BLUE', [], []));
check('E4', 'myHeroId 为空 → 不动作', { action: 'none' },
  validateMyHero(null, 'BLUE', [HERO.A], []));

// =====================================================================
// 汇总
// =====================================================================
const total = RESULTS.length;
const passed = RESULTS.filter((r) => r.pass).length;
console.log('\n' + '='.repeat(70));
console.log(`  链路测试: ${total} 项 / 通过 ${passed} / 失败 ${total - passed}`);
for (const r of RESULTS) {
  if (!r.pass) console.log(`    [FAIL] ${r.case} ${r.item}: expect=${JSON.stringify(r.expected)} actual=${JSON.stringify(r.actual)}`);
}
console.log('='.repeat(70));

writeFileSync(
  '_diag/test_pipeline.json',
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      total,
      passed,
      failed: total - passed,
      records: RESULTS,
    },
    null,
    2,
  ),
  'utf-8',
);
console.log('明细: _diag/test_pipeline.json');
process.exit(passed === total ? 0 : 1);
