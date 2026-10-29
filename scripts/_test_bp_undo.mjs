// -*- coding: utf-8 -*-
// BP 模拟页「填入 → 撤销 → 点击切换槽位 → 再填入」顺序问题复现/回归测试
//
// 背景（用户反馈）：
//   「填入撤销的时候有点问题哦，顺序上，你让测试小鱼试试，点击切换再输入顺序会乱」
//
// 复现结论（2026-10-29，修复前）：
//   1) 点击某个槽位手动填入英雄时，setPickAt/setBanAt 会用 '' 补齐前导空位
//      （如蓝3 = ['', '', hero]）；
//   2) 旧 undo() 不是操作栈，而是按 pickTurnIndex / phase「反推」上一步，
//      且只对数组做 slice(0, -1)（删尾）；
//   3) 于是「手动填非顺序位 → 撤销 → 再顺序填入」时：撤销后数组仍保留前导空位，
//      selectHero 用 append 追加到数组尾部 → 英雄再次落到第 3 位（而不是第 1 个空位）；
//   4) 手动替换/清空槽位后撤销还会删错阵营、删错英雄，甚至抛 TypeError
//      （pickTurnIndex=0 但 picks 数组长度>0 时 PICK_SEQUENCE[-1] 为 undefined）。
//
// 修复（Lead commit b1d7e99）：undo 改操作栈精确快照恢复；selectHero/fillSlot 优先填
// 第一个空位；nextTurnIndex 按 PICK_SEQUENCE 找下一个未填够的 turn；setPickAt/
// setBanAt/skipBan/importBans 均 push 快照；崩溃自然消失。
//
// 本文件现在同时是「修复验证 + 回归守卫」：
//   - 普通断言必须通过；
//   - 原缺陷用例仍带 knownBug 标记：若将来退化会再次打印 [BUG]，修复状态打印 [FIXED]。
//   默认退出码 0（BUG 只报告）；加 --strict 时若有未修复 BUG 退出 1。
//
// 注意：撤销语义已从「按数量反推」变为「精确快照恢复」：
//   - 撤销清空操作 = 恢复清空前（保留英雄）
//   - 撤销 skipBan（进入 PICK）= 回到 skipBan 前的 ENEMY_BAN，ban 数据不变
//
// 跑法：
//   node scripts/_test_bp_undo.mjs            # 常规（BUG 只提示）
//   node scripts/_test_bp_undo.mjs --strict   # CI 模式（BUG 未修 → 退出 1）
// 输出：_diag/test_bp_undo.json
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';

const STRICT = process.argv.includes('--strict');
const OUT = '_diag/_bundle_undo_test';
mkdirSync(OUT, { recursive: true });

// ---------- 1. 打包 store（与 _test_pipeline.mjs 相同模式） ----------
console.log('[1/3] 打包 bpStore...');
await build({
  entryPoints: { bpStore: 'src/store/bpStore.ts' },
  bundle: true,
  format: 'esm',
  outdir: OUT,
  platform: 'node',
  external: ['react'],
  logLevel: 'error',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '""',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'false',
    'import.meta.env.MODE': '"test"',
  },
});

// ---------- 2. mock window + localStorage（zustand persist 用） ----------
const lsStore = {};
const mockStorage = {
  getItem: (k) => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => {
    lsStore[k] = String(v);
  },
  removeItem: (k) => {
    delete lsStore[k];
  },
  clear: () => {
    Object.keys(lsStore).forEach((k) => delete lsStore[k]);
  },
};
globalThis.localStorage = mockStorage;
if (typeof globalThis.window === 'undefined') globalThis.window = {};
globalThis.window.localStorage = mockStorage;

// ---------- 3. 导入 store ----------
const { useBpStore } = await import(pathToFileURL(`${OUT}/bpStore.js`).href);
const bp = () => useBpStore.getState();

// ---------- 测试框架 ----------
const RESULTS = [];
const BUGS = [];
const FIXED = [];
let sectionName = '';

function section(t) {
  sectionName = t;
  console.log(`\n--- ${t} ---`);
}

/**
 * 断言期望行为。
 * @param {string} name 用例名
 * @param {*} expected 期望
 * @param {*} actual 实际
 * @param {{knownBug?:boolean, bugId?:string, note?:string}} opts
 */
function check(name, expected, actual, opts = {}) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  const rec = {
    case: sectionName, item: name, expected, actual, pass: ok,
    knownBug: Boolean(opts.knownBug), bugId: opts.bugId || null, note: opts.note || '',
  };
  RESULTS.push(rec);
  if (ok) {
    if (opts.knownBug) {
      FIXED.push(rec);
      console.log(`  [FIXED] ${opts.bugId || ''} ${name}：已知缺陷已修复（期望值已满足）`);
    } else {
      console.log(`  [PASS] ${name}`);
    }
  } else if (opts.knownBug) {
    BUGS.push(rec);
    console.log(`  [BUG ${opts.bugId || ''}] ${name}`);
    console.log(`        expect=${JSON.stringify(expected)}`);
    console.log(`        actual=${JSON.stringify(actual)}`);
    if (opts.note) console.log(`        note: ${opts.note}`);
  } else {
    console.log(`  [FAIL] ${name}: expect=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
  return ok;
}

/** 捕获异常并返回 {threw, name, message} */
function capture(fn) {
  try {
    fn();
    return { threw: false, name: null, message: null };
  } catch (e) {
    return { threw: true, name: e?.constructor?.name || 'Error', message: String(e?.message || e) };
  }
}

// ---------- 工具 ----------
const HERO = {
  A: 'direnjie', B: 'luban', C: 'sunshangxiang', D: 'houyi', E: 'makeboluo',
  F: 'yao', G: 'daji', H: 'anqila', I: 'xiaoqiao', J: 'zhenji',
};

/** 进入 PICK 阶段（清空 ban） */
function pickPhase() {
  bp().reset();
  bp().skipBan();
  bp().skipBan();
}

/** 紧凑快照：保留 '' 空洞，便于断言「落点」 */
function snap() {
  const s = bp();
  return {
    phase: s.phase,
    turn: s.pickTurnIndex,
    blue: s.bluePicks.map((x) => x || '_'),
    red: s.redPicks.map((x) => x || '_'),
  };
}

/** 当前「顺序填入」会落到哪个位置（用于断言落点） */
function nextFillTarget() {
  const s = snap();
  return { phase: s.phase, blue: s.blue, red: s.red };
}

// =====================================================================
// A. 基准：正常顺序填入 → 撤销 → 再填入
// =====================================================================
section('A. 基准：连续填入 → 撤销 → 再填入（无手动槽位）');
pickPhase();
bp().selectHero(HERO.A); // 蓝1（PICK_SEQUENCE[0]=BLUE）
bp().selectHero(HERO.F); // 红1
bp().selectHero(HERO.G); // 红2
check('A1 连续填入 3 个：回合/落点',
  { turn: 3, blue: [HERO.A], red: [HERO.F, HERO.G] },
  { turn: snap().turn, blue: snap().blue, red: snap().red });
bp().undo();
check('A2 撤销 1 次：删红2、回合-1', { phase: 'PICK', turn: 2, blue: [HERO.A], red: [HERO.F] }, snap());
bp().selectHero(HERO.H);
check('A3 再填入：应落红2',
  { phase: 'PICK', turn: 3, blue: [HERO.A], red: [HERO.F, HERO.H] }, snap());

// =====================================================================
// B. 【用户症状】点击非顺序槽位填入 → 撤销 → 再填入
//    期望：撤销后前导空位清掉，下一次「填入」落到第一个空位
// =====================================================================
section('B. 用户症状：点蓝3填入 → 撤销 → 再填入（落点错乱）');
pickPhase();
bp().setPickAt('BLUE', 2, HERO.A); // 点击蓝3槽位填入英雄
check('B1 点击蓝3填入：hero 落蓝3', { blue: ['_', '_', HERO.A] },
  { blue: snap().blue }, { knownBug: false });
bp().undo();
check('B2 撤销后：蓝方数组应为空（不保留前导空位）', { blue: [], red: [] },
  { blue: snap().blue, red: snap().red },
  {
    knownBug: true,
    bugId: 'BUG-1',
    note: "undo 对数组只做 slice(0,-1)，['','',X] → ['','']，前导空位残留",
  });
bp().selectHero(HERO.B);
check('B3 再填入：英雄应落蓝1', { blue: [HERO.B], red: [] },
  { blue: snap().blue, red: snap().red },
  {
    knownBug: true,
    bugId: 'BUG-1',
    note: "selectHero 用 append 追加数组尾 → ['','',B] 落到蓝3（用户看到的「顺序乱」）",
  });

// =====================================================================
// C. 手动填入的槽位不是当前回合时，撤销要撤销「最近一次操作」
//    注：新语义下 pickTurnIndex 由 nextTurnIndex 计算（第一个未填够的 turn）。
//    蓝方手填 2 个（蓝1/蓝2）→ 蓝方 quota 里 turn[0] 已覆盖，下一个未填够的是
//    turn[1]（红方第 1 个）→ turn=1 是正确值（不是已填数量 2）。
// =====================================================================
section('C. 顺序填入蓝1 → 点击蓝2填入 → 撤销（应撤销最近的蓝2）');
pickPhase();
bp().selectHero(HERO.A); // 蓝1
bp().setPickAt('BLUE', 1, HERO.B); // 点蓝2填入
check('C1 填入后状态：蓝2 已填、下一回合为红1（turn=1）',
  { phase: 'PICK', turn: 1, blue: [HERO.A, HERO.B], red: [] }, snap(),
  { note: 'nextTurnIndex：蓝方已填 2 个仍在 turn[0] 覆盖范围，第一个未填够的是 turn[1] 红方' });
bp().undo();
check('C2 撤销后：应只回退最近的蓝2，蓝1保留',
  { phase: 'PICK', turn: 1, blue: [HERO.A], red: [] }, snap(),
  {
    knownBug: true,
    bugId: 'BUG-2',
    note: '修复前：undo 按 pickTurnIndex=2 反推 prevTurn=PICK_SEQUENCE[1]=RED，去删红方（空操作），蓝2B 残留',
  });

// =====================================================================
// D. 清空槽位后撤销（不应崩溃；撤销清空 = 恢复清空前）
// =====================================================================
section('D. 点蓝1填入 → 清空蓝1 → 撤销（应恢复清空前，不崩溃）');
pickPhase();
bp().setPickAt('BLUE', 0, HERO.A);
bp().setPickAt('BLUE', 0, ''); // 清空该位：数组长度 1（['']），非空数 0
check('D1 清空后：pickTurnIndex=0 但数组长度保留 1', { turn: 0, blue: ['_'] },
  { turn: snap().turn, blue: snap().blue });
const undoResult = capture(() => bp().undo());
check('D2 撤销不应抛异常', { threw: false }, { threw: undoResult.threw },
  {
    knownBug: true,
    bugId: 'BUG-3',
    note: `修复前抛 ${undoResult.name}: ${undoResult.message}（PICK_SEQUENCE[-1] 为 undefined）`,
  });
check('D3 撤销清空 = 精确恢复清空前（PICK + 蓝1 英雄）',
  { phase: 'PICK', turn: 1, blue: [HERO.A], red: [] }, snap(),
  { note: '新语义：Ctrl+Z 撤销「清空」这一步 → 回到清空前状态（英雄回来）' });

// =====================================================================
// E. 手动替换已有槽位后撤销：应恢复「前值」
// =====================================================================
section('E. 撤销栈前值：蓝1=A 后手动改成 B → 撤销应恢复 A');
pickPhase();
bp().selectHero(HERO.A); // 蓝1=A
bp().setPickAt('BLUE', 0, HERO.B); // 手动替换蓝1=B
check('E1 替换后蓝1=B', { blue: [HERO.B] }, { blue: snap().blue.slice(0, 1) });
bp().undo();
check('E2 撤销后应恢复前值 A（而不是删空）', { turn: 1, blue: [HERO.A] },
  { turn: snap().turn, blue: snap().blue },
  {
    knownBug: true,
    bugId: 'BUG-4',
    note: 'undo 无操作栈、无前值记录：slice(0,-1) 把 B 删掉，A 不会回来',
  });

// =====================================================================
// F. ban 阶段同样问题：点 ban3 填入 → 撤销 → 再填入（应落 ban1）
// =====================================================================
section('F. ban 阶段：点蓝 ban3 填入 → 撤销 → 再填入');
bp().reset();
bp().setBanAt('BLUE', 2, HERO.A);
bp().undo();
check('F1 撤销后 ban 数组应清掉尾部空洞', { blueBans: [] }, { blueBans: bp().blueBans.map((x) => x || '_') },
  { knownBug: true, bugId: 'BUG-5', note: "['','',X] slice 后变 ['','']，空洞残留" });
bp().selectHero(HERO.B);
check('F2 再填入 ban：应落我方 ban1', { blueBans: [HERO.B] },
  { blueBans: bp().blueBans.map((x) => x || '_') },
  {
    knownBug: true,
    bugId: 'BUG-5',
    note: "selectHero append → ['','',B] 落到 ban3（ban 阶段同样「顺序乱」）",
  });

// =====================================================================
// G. 基准：PICK 空撤销 = 撤销「进入 PICK」（skipBan 快照恢复）
// =====================================================================
section('G. 基准：PICK 阶段空撤销 → 回 ENEMY_BAN（ban 数据保留）');
bp().reset();
bp().setBanAt('BLUE', 0, HERO.A);
bp().skipBan(); // → ENEMY_BAN
bp().setBanAt('RED', 0, HERO.F);
bp().skipBan(); // → PICK
bp().undo();
check('G1 回 ENEMY_BAN 且敌方 ban 保留（撤销的是 skipBan，不是删 ban）',
  { phase: 'ENEMY_BAN', blueBans: [HERO.A], redBans: [HERO.F] },
  { phase: bp().phase, blueBans: bp().blueBans, redBans: bp().redBans },
  { note: '新语义：操作栈精确恢复 skipBan 前的快照（旧逻辑会 slice 掉最后一个 ban）' });

// =====================================================================
// H. 基准：FINISHED 撤销 → 回 PICK 并删最后一个 pick
// =====================================================================
section('H. 基准：FINISHED 撤销');
pickPhase();
const ORDER = [HERO.A, HERO.F, HERO.G, HERO.B, HERO.C, HERO.D, HERO.E, HERO.H, HERO.I, HERO.J];
for (const hero of ORDER) bp().selectHero(hero);
check('H1 填满 10 个 → FINISHED', { phase: 'FINISHED', turn: 10 },
  { phase: bp().phase, turn: bp().pickTurnIndex });
bp().undo();
check('H2 撤销后回 PICK，红方最后一个被移除（应剩 4 个）',
  { phase: 'PICK', turn: 9, redCount: 4, blueCount: 5 },
  { phase: bp().phase, turn: bp().pickTurnIndex,
    redCount: bp().redPicks.filter(Boolean).length,
    blueCount: bp().bluePicks.filter(Boolean).length });

// =====================================================================
// I. 基准：切换阵营后填入（游戏顺序固定蓝先，不是 bug，记录下来）
// =====================================================================
section('I. 基准：切阵营后再填入（PICK_SEQUENCE 是绝对蓝/红顺序）');
pickPhase();
bp().selectHero(HERO.A); // 蓝1
bp().undo();
bp().setUserSide('RED'); // 切换我方阵营
bp().selectHero(HERO.F);
check('I1 切到红方后，下一次填入仍按游戏顺序落蓝1', { side: 'RED', turn: 1, blue: [HERO.F] },
  { side: bp().userSide, turn: bp().pickTurnIndex, blue: snap().blue },
  { note: 'PICK_SEQUENCE 恒为蓝先选（游戏规则），切换阵营只影响「我方/敌方」标注' });

// =====================================================================
// J. 操作栈：多步撤销逐级精确恢复
// =====================================================================
section('J. 操作栈：多步撤销逐级恢复（fill×3 → undo×4）');
pickPhase();
bp().selectHero(HERO.A); // 蓝1
bp().selectHero(HERO.F); // 红1
bp().selectHero(HERO.G); // 红2
bp().undo();
check('J1 undo×1：回到只填蓝1+红1', { phase: 'PICK', turn: 2, blue: [HERO.A], red: [HERO.F] }, snap());
bp().undo();
check('J2 undo×2：回到只填蓝1', { phase: 'PICK', turn: 1, blue: [HERO.A], red: [] }, snap());
bp().undo();
check('J3 undo×3：回到刚进入 PICK（全空）', { phase: 'PICK', turn: 0, blue: [], red: [] }, snap());
bp().undo();
check('J4 undo×4：回到 skipBan 前（ENEMY_BAN）', { phase: 'ENEMY_BAN', turn: 0, blue: [], red: [] }, snap());

// =====================================================================
// K. 重置清空撤销栈；L. 超出栈深度的 undo 不崩溃
// =====================================================================
section('K/L. reset 清栈 + 连续 undo 超栈深不崩溃');
bp().reset();
pickPhase();
bp().selectHero(HERO.A);
bp().reset();
const resetUndo = capture(() => bp().undo());
check('K1 reset 后 undo 为空操作（不进历史）',
  { threw: false, phase: 'MY_BAN', blue: [], red: [] },
  { threw: resetUndo.threw, phase: bp().phase, blue: bp().bluePicks, red: bp().redPicks });

pickPhase();
bp().selectHero(HERO.A);
bp().selectHero(HERO.F);
const deepUndo = capture(() => {
  for (let i = 0; i < 20; i += 1) bp().undo();
});
check('L1 连续 undo 20 次不崩溃，最终回到最早快照（MY_BAN）',
  { threw: false, phase: 'MY_BAN', blue: [], red: [] },
  { threw: deepUndo.threw, phase: bp().phase, blue: bp().bluePicks, red: bp().redPicks },
  { note: '历史栈最多 50 条；耗尽后 undo 为 no-op' });

// =====================================================================
// M. nextTurnIndex：乱序手填后，下一回合 = 第一个「该方未填够」的 turn
// =====================================================================
section('M. nextTurnIndex：乱序手填后回合计算');
pickPhase();
bp().setPickAt('BLUE', 1, HERO.A); // 手填蓝2（蓝1 空）
check('M1 蓝方已填 1（蓝2），下一回合应为红1（turn=1）', { turn: 1, blue: ['_', HERO.A] },
  { turn: snap().turn, blue: snap().blue });
bp().setPickAt('RED', 0, HERO.F); // 手填红1
check('M2 红方已填 1，下一回合应为红2（turn=2，红方还需 2 个中的第 2 个）',
  { turn: 2, blue: ['_', HERO.A], red: [HERO.F] },
  { turn: snap().turn, blue: snap().blue, red: snap().red });


const total = RESULTS.length;
const passed = RESULTS.filter((r) => r.pass && !r.knownBug).length;
const failed = RESULTS.filter((r) => !r.pass && !r.knownBug).length;
console.log('\n' + '='.repeat(78));
console.log(`  BP 撤销/填入顺序测试: ${total} 项 | PASS ${passed} | BUG复现 ${BUGS.length} | 已修复 ${FIXED.length} | 意外失败 ${failed}`);
for (const b of BUGS) {
  console.log(`    [BUG ${b.bugId}] ${b.case} / ${b.item}`);
  console.log(`          expect=${JSON.stringify(b.expected)}  actual=${JSON.stringify(b.actual)}`);
}
if (failed) {
  for (const r of RESULTS.filter((x) => !x.pass && !x.knownBug)) {
    console.log(`    [FAIL] ${r.case} / ${r.item}: expect=${JSON.stringify(r.expected)} actual=${JSON.stringify(r.actual)}`);
  }
}
console.log('='.repeat(78));

writeFileSync(
  '_diag/test_bp_undo.json',
  JSON.stringify({
    generated: new Date().toISOString(),
    total, passed, failed,
    bugCount: BUGS.length,
    fixedCount: FIXED.length,
    records: RESULTS,
  }, null, 2),
  'utf-8',
);
console.log('明细: _diag/test_bp_undo.json');

const exitCode = failed > 0 || (STRICT && BUGS.length > 0) ? 1 : 0;
process.exit(exitCode);
