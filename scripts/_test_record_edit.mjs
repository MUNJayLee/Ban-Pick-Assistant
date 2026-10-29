// -*- coding: utf-8 -*-
// 记录详情页（RecordEditModal）「我的英雄」逻辑回归测试
//
// 用户反馈：「记录详情页里选择我的英雄逻辑有问题」
// 根因（Lead commit 4a6bd16）：选择器用 allUsedIds（ban+pick）判断可用性，
//   但保存时 handleSave 只认 bluePicks/redPicks → 用户能选被 ban 的英雄，
//   保存时被静默清空（无提示）。
// 修复：myHeroCandidates = 双方 picks（不含 ban）；myHero 选择器禁用非候选；
//   无效时显示警告；保存仍兜底清空。
//
// 本测试用 Edge headless + CDP 跑真实组件（项目无 RTL/jsdom）：
//   1. 选择 ban 英雄 → 选择器禁用（不可选）
//   2. 选择双方 picks（蓝方 pick）→ 保存成功
//   3. 选择敌方 pick（红方英雄）→ 允许
//   4. 先选我的英雄，再把该英雄从阵容删掉 → 保存前警告 + 保存后清空
//   5. 旧脏数据（myHeroId=ban 英雄）→ 打开弹窗即警告，保存后清空
//   6. ban 英雄不在「我的英雄」可选列表
//   7. 槽位选择器：禁用已出场英雄（ban+pick 不可重复），但排除当前编辑槽位自身的英雄
//      （允许重选/覆盖）—— Lead a9fe27e 修复，15 个已出场 - 当前槽位 1 = 14 个禁用
// 另验证：选择器标题区分（「选择英雄」/「选择我的英雄（仅双方已选）」）、
//         候选数量 = 双方 picks 去重数。
//
// 跑法：node scripts/_test_record_edit.mjs
// 前置：vite dev server 5173、Edge 可用（API 8900 非必需）
// 输出：_diag/test_record_edit.json + 截图
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL_APP = 'http://localhost:5173/';
const OUT_DIR = '_diag';
const PORT = 9334;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const STORAGE_KEY = 'bp-records-v1';
const RESULTS = [];
let msgId = 0;
const pending = new Map();
let ws = null;

// ---------- 测试记录 fixture ----------
const CLEAN = {
  id: 'rec_clean',
  timestamp: Date.now() - 120000,
  bluePicks: ['direnjie', 'sunshangxiang', 'houyi', 'makeboluo', 'zhaoyun'],
  redPicks: ['yao', 'daji', 'anqila', 'xiaoqiao', 'zhenji'],
  blueBans: ['lianpo', 'zhangfei', 'luna', 'sunbin', 'zhangliang'],
  redBans: ['zhangliang', 'sunbin', 'luna', 'zhangfei', 'lianpo'],
  bluePower: 50.2,
  redPower: 49.8,
  favored: 'EVEN',
  result: 'PENDING',
  actualResult: 'PENDING',
  myHeroId: 'direnjie', // 蓝方 pick1（合法）
  mySide: 'BLUE',
  myRole: 'MARKSMAN',
  note: '测试记录-经典',
};
// 旧脏数据：myHeroId 是 ban 英雄（廉颇），应触发警告并在保存时清空
const DIRTY = {
  ...CLEAN,
  id: 'rec_dirty',
  timestamp: Date.now() - 60000,
  bluePicks: [...CLEAN.bluePicks],
  redPicks: [...CLEAN.redPicks],
  blueBans: [...CLEAN.blueBans],
  redBans: [...CLEAN.redBans],
  myHeroId: 'lianpo', // ban 英雄 → 脏数据
  note: '测试记录-脏数据',
};

const INCOMPLETE = [];

function rec(item, expected, actual, pass, note = '', opts = {}) {
  const exp = expected && typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
  const act = typeof actual === 'string' ? actual : JSON.stringify(actual);
  const r = { item, expected: exp, actual: act, pass: !!pass, note, incomplete: Boolean(opts.incomplete) };
  RESULTS.push(r);
  if (!pass && opts.incomplete) {
    INCOMPLETE.push(r);
    console.log(`[INCOMPLETE] ${item.padEnd(36)} expect=${exp.padEnd(30)} actual=${act} ${note}`);
  } else {
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${item.padEnd(38)} expect=${exp.padEnd(30)} actual=${act} ${note}`);
  }
  return pass;
}

// ---------- CDP 基础设施（同 _test_frontend.mjs 模式） ----------
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }
    }, 30000);
  });
}

async function evaluate(expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true });
  if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log('    screenshot ->', p);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(expression, timeoutMs = 15000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(expression);
      if (last) return last;
    } catch {
      /* 导航中 */
    }
    await sleep(intervalMs);
  }
  return last;
}

async function listTargets() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('Edge CDP 未就绪');
}

async function checkEnv() {
  const problems = [];
  if (!fs.existsSync(EDGE)) problems.push(`Edge 不存在：${EDGE}`);
  try {
    const res = await fetch(URL_APP, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) problems.push(`前端 dev server 返回 HTTP ${res.status}：${URL_APP}`);
  } catch {
    problems.push(`前端 dev server 未启动：${URL_APP}`);
  }
  if (problems.length) {
    console.error('='.repeat(78));
    console.error('  [环境未就绪] 记录编辑弹窗测试无法执行：');
    for (const p of problems) console.error('   - ' + p);
    console.error('');
    console.error('  请先：1) npm run dev（端口 5173）  2) 确认 Edge 路径');
    console.error('  本次未执行任何用例（不是测试失败）。');
    console.error('='.repeat(78));
    process.exit(2);
  }
}

// ---------- 页面操作 helper ----------
async function seedAndReload(records) {
  const payload = JSON.stringify({ state: { records }, version: 1 });
  await evaluate(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(payload)})`);
  await send('Page.navigate', { url: `${URL_APP}?t=${Date.now()}#records` });
  const ok = await waitFor(`document.querySelectorAll('button[title="编辑记录"]').length >= 1`);
  return ok;
}

async function openEditForNote(note) {
  return evaluate(`(() => {
    const note = ${JSON.stringify(note)};
    const leaf = [...document.querySelectorAll('p,span,div')].find(
      (el) => el.children.length === 0 && el.textContent && el.textContent.includes(note),
    );
    if (!leaf) return { ok: false, reason: 'note-not-found' };
    let node = leaf;
    for (let i = 0; i < 12 && node; i += 1) {
      node = node.parentElement;
      if (!node) break;
      const btn = node.querySelector('button[title="编辑记录"]');
      if (btn) {
        btn.click();
        return { ok: true };
      }
    }
    return { ok: false, reason: 'edit-button-not-found' };
  })()`);
}

const modalOpen = () =>
  evaluate(`(() => {
    const t = document.body.innerText;
    return t.includes('编辑记录') && t.includes('我的英雄') && t.includes('保存');
  })()`);

async function openMyHeroPicker() {
  return evaluate(`(() => {
    const label = [...document.querySelectorAll('div')].find(
      (d) => d.children.length === 0 && d.textContent.trim() === '我的英雄',
    );
    if (!label || !label.nextElementSibling) return false;
    const btn = label.nextElementSibling.querySelector('button');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
}

async function openSlotPicker(title) {
  return evaluate(`(() => {
    const b = document.querySelector('button[title=${JSON.stringify(title)}]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
}

async function pickerTitle() {
  return evaluate(`(() => {
    if (document.body.innerText.includes('选择我的英雄（仅双方已选）')) return 'my-hero';
    if (document.body.innerText.includes('选择英雄')) return 'slot';
    return null;
  })()`);
}

async function closePicker() {
  return evaluate(`(() => {
    const span = [...document.querySelectorAll('span')].find(
      (s) => s.textContent && (s.textContent.includes('选择英雄') || s.textContent.includes('选择我的英雄')),
    );
    if (!span || !span.parentElement) return false;
    const btn = span.parentElement.querySelector('button');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
}

/** 选择器覆盖层内英雄按钮可用性统计（按标题定位是槽位选择还是我的英雄选择）。 */
async function pickerStats(titleText) {
  return evaluate(`(() => {
    const titleSpan = [...document.querySelectorAll('span')].find(
      (s) => s.textContent && s.textContent.includes(${JSON.stringify(titleText)}),
    );
    if (!titleSpan) return { error: 'picker-not-open' };
    const overlay = titleSpan.closest('.fixed');
    if (!overlay) return { error: 'overlay-not-found' };
    const btns = [...overlay.querySelectorAll('button[title]')];
    const enabled = btns.filter((b) => !b.disabled).map((b) => b.title);
    const disabled = btns.filter((b) => b.disabled).map((b) => b.title);
    const byTitle = (name) => btns.find((b) => b.title === name);
    return {
      total: btns.length,
      enabled,
      enabledCount: enabled.length,
      disabled,
      disabledCount: disabled.length,
      lianpoDisabled: byTitle('廉颇') ? byTitle('廉颇').disabled : null,
      lianpoExists: Boolean(byTitle('廉颇')),
      direnjieDisabled: byTitle('狄仁杰') ? byTitle('狄仁杰').disabled : null,
    };
  })()`);
}

async function heroPickerStats() {
  return pickerStats('选择我的英雄');
}

async function clickHero(title) {
  return evaluate(`(() => {
    const b = document.querySelector('button[title=${JSON.stringify(title)}]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
}

/** 当前「我的英雄」按钮文字（去掉头像占位字/换行，如 "狄\n狄仁杰" → "狄仁杰"）。 */
async function myHeroButtonText() {
  return evaluate(`(() => {
    const label = [...document.querySelectorAll('div')].find(
      (d) => d.children.length === 0 && d.textContent.trim() === '我的英雄',
    );
    if (!label || !label.nextElementSibling) return null;
    const btn = label.nextElementSibling.querySelector('button');
    if (!btn) return null;
    // 按钮内是 <HeroAvatar>(含首字 span) + 直接文本节点(英雄全名)，
    // 只取直接文本节点，避免把头像占位首字拼进来（"狄" + "狄仁杰"）。
    const direct = [...btn.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent || '')
      .join('')
      .trim();
    return direct || btn.innerText.replace(/\\s+/g, '');
  })()`);
}

/** 清空蓝方 pick 第 1 格（hover 才显示的「清空」按钮）。 */
async function clearBluePick1() {
  return evaluate(`(() => {
    const slot = document.querySelector('button[title="蓝方选人 1"]');
    if (!slot || !slot.parentElement) return false;
    const clear = slot.parentElement.querySelector('button[title="清空"]');
    if (!clear) return false;
    clear.click();
    return true;
  })()`);
}

const warningVisible = () =>
  evaluate(`document.body.innerText.includes('当前英雄不在本局已选阵容里，保存时会被清空')`);

async function clickSave() {
  return evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '保存');
    if (!b) return false;
    b.click();
    return true;
  })()`);
}

async function readRecord(id) {
  return evaluate(`(() => {
    try {
      const d = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || '{}');
      const rec = (d.state?.records || []).find((r) => r.id === ${JSON.stringify(id)});
      return rec
        ? { myHeroId: rec.myHeroId ?? null, bluePicks: rec.bluePicks, redPicks: rec.redPicks, note: rec.note }
        : { error: 'record-not-found' };
    } catch (e) {
      return { error: String(e) };
    }
  })()`);
}

async function closeModalIfOpen() {
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '取消');
    if (b) b.click();
    return true;
  })()`);
  await sleep(200);
}

// ---------- 主流程 ----------
async function main() {
  await checkEnv();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-edge-rec-'));
  const child = spawn(
    EDGE,
    [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--mute-audio', '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      '--window-size=1600,1000', 'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  console.log('启动 Edge headless:', EDGE);
  try {
    const target = await listTargets();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    // ---------- 0. 环境检查：应用可加载 + 记录页可打开 ----------
    await send('Page.navigate', { url: URL_APP });
    await waitFor(`document.getElementById('root')?.children.length > 0`, 20000);
    let seeded = await seedAndReload([CLEAN, DIRTY]);
    rec('0 记录页可加载并渲染 2 条测试记录', '≥1 个编辑按钮', seeded ? 'ok' : '未找到编辑按钮', seeded);

    // ---------- 1. 选择 ban 英雄作为「我的英雄」→ 选择器禁用 ----------
    let r = await openEditForNote(CLEAN.note);
    await sleep(450);
    const opened = await modalOpen();
    rec('1.0 打开编辑弹窗', 'modal open', opened, r?.ok && opened);

    // 1a. 槽位选择器标题 = 「选择英雄」
    await openSlotPicker('蓝方选人 2');
    await sleep(300);
    const slotTitle = await pickerTitle();
    rec('1.1 槽位选择器标题', 'slot（选择英雄）', slotTitle, slotTitle === 'slot');
    await closePicker();
    await sleep(250);

    // 1b. 我的英雄选择器标题 + 候选仅 picks
    await openMyHeroPicker();
    await sleep(300);
    const myTitle = await pickerTitle();
    rec('1.2 我的英雄选择器标题', 'my-hero（选择我的英雄（仅双方已选））', myTitle, myTitle === 'my-hero');
    const stats = await heroPickerStats();
    rec('1.3 ban 英雄不可选（廉颇 disabled）', { lianpoExists: true, lianpoDisabled: true },
      { lianpoExists: stats?.lianpoExists, lianpoDisabled: stats?.lianpoDisabled },
      stats?.lianpoExists === true && stats?.lianpoDisabled === true, 'ban 位英雄不在双方 picks 里');
    rec('1.4 可选项 = 双方 picks 去重数（10）', 10, stats?.enabledCount,
      stats?.enabledCount === 10, `enabled=${JSON.stringify(stats?.enabled || [])}`);
    rec('1.5 其余英雄全部禁用（总 133）', { total: 133, disabled: 123 },
      { total: stats?.total, disabled: stats?.disabledCount },
      stats?.total === 133 && stats?.disabledCount === 123);

    // 1c. 点击被禁用的 ban 英雄 → 选择器不关闭、不选中
    await clickHero('廉颇');
    await sleep(300);
    const afterClickBan = { picker: await pickerTitle(), myHero: await myHeroButtonText() };
    rec('1.6 点击 ban 英雄无效（选择器仍开）', { picker: 'my-hero', myHero: '狄仁杰' },
      afterClickBan, afterClickBan.picker === 'my-hero' && afterClickBan.myHero === '狄仁杰');
    await closePicker();
    await sleep(200);
    await shot('test_record_edit_picker.png');

    // ---------- 2. 选择双方 picks（蓝方 pick2 孙尚香）→ 保存成功 ----------
    await openMyHeroPicker();
    await sleep(250);
    await clickHero('孙尚香');
    await sleep(300);
    const afterPickBlue = await myHeroButtonText();
    await clickSave();
    await sleep(600);
    let saved = await readRecord(CLEAN.id);
    rec('2 选择蓝方 pick 为我的英雄 → 保存成功', { myHeroId: 'sunshangxiang', note: CLEAN.note },
      { myHeroId: saved?.myHeroId, note: saved?.note },
      saved?.myHeroId === 'sunshangxiang' && saved?.note === CLEAN.note,
      `按钮显示=${JSON.stringify(afterPickBlue)}`);

    // ---------- 3. 选择敌方 pick（红方 瑶）→ 允许 ----------
    await seedAndReload([CLEAN, DIRTY]);
    await openEditForNote(CLEAN.note);
    await openMyHeroPicker();
    await sleep(250);
    const yaoBtn = await heroPickerStats();
    const yaoEnabled = (yaoBtn?.enabled || []).includes('瑶');
    rec('3.0 敌方 pick（瑶）可选', true, yaoEnabled, yaoEnabled);
    await clickHero('瑶');
    await sleep(300);
    await clickSave();
    await sleep(600);
    saved = await readRecord(CLEAN.id);
    rec('3 选择敌方 pick 为我的英雄 → 保存成功', 'yao', saved?.myHeroId, saved?.myHeroId === 'yao');

    // ---------- 4. 先选我的英雄，再删掉该英雄 → 警告 + 保存后清空 ----------
    await seedAndReload([CLEAN, DIRTY]);
    await openEditForNote(CLEAN.note); // myHeroId=direnjie（蓝1）
    const cleared = await clearBluePick1();
    await sleep(300);
    const warn4 = await warningVisible();
    rec('4.0 清空我的英雄所在 pick → 显示警告', true, warn4, cleared && warn4 === true);
    await shot('test_record_edit_warning.png');
    await clickSave();
    await sleep(600);
    saved = await readRecord(CLEAN.id);
    rec('4 删除英雄后保存 → myHeroId 被清空', { myHeroId: null, bluePicks: ['', 'sunshangxiang', 'houyi', 'makeboluo', 'zhaoyun'] },
      { myHeroId: saved?.myHeroId, bluePicks: saved?.bluePicks },
      saved?.myHeroId === null && saved?.bluePicks?.[0] === '');

    // ---------- 5. 旧脏数据（myHeroId=ban 英雄）→ 打开即警告 + 保存清空 ----------
    await seedAndReload([CLEAN, DIRTY]);
    await openEditForNote(DIRTY.note);
    await sleep(300);
    const warn5 = await warningVisible();
    const dirtyBtn = await myHeroButtonText();
    rec('5.0 脏数据打开弹窗即显示警告', { warning: true, button: '廉颇' },
      { warning: warn5, button: dirtyBtn }, warn5 === true && dirtyBtn === '廉颇',
      'myHeroId=廉颇（ban 英雄）不在双方 picks');
    await shot('test_record_edit_dirty.png');
    await clickSave();
    await sleep(600);
    saved = await readRecord(DIRTY.id);
    rec('5 脏数据保存 → myHeroId 被清空', { myHeroId: null, note: DIRTY.note },
      { myHeroId: saved?.myHeroId, note: saved?.note },
      saved?.myHeroId === null && saved?.note === DIRTY.note);

    // ---------- 6. 双方 picks 之外（ban）英雄不在「我的英雄」可选列表 ----------
    await seedAndReload([CLEAN, DIRTY]);
    await openEditForNote(CLEAN.note);
    await openMyHeroPicker();
    await sleep(300);
    const stats6 = await heroPickerStats();
    const banNames = ['廉颇', '张飞', '露娜', '孙膑', '张良'];
    const hasBanInEnabled = (stats6?.enabled || []).some((n) => banNames.includes(n));
    rec('6 ban 英雄不在可选列表（廉颇/张飞/露娜/孙膑/张良）', false, hasBanInEnabled, !hasBanInEnabled);
    await closePicker();
    await closeModalIfOpen();

    // ---------- 7. 槽位选择器：禁用已出场英雄，但排除「当前槽位自身」 ----------
    // 设计（Lead a9fe27e）：槽位选择禁用已出场英雄（ban+pick 不可重复），
    //   但当前编辑槽位自己的英雄必须可选（允许重选/覆盖，否则改不动）。
    // fixture：已出场 15 个（10 picks + 5 个去重 ban），当前槽位「蓝方选人 2」= 孙尚香
    //   → 禁用 = 15 - 1（当前槽位自身）= 14
    await seedAndReload([CLEAN, DIRTY]);
    await openEditForNote(CLEAN.note);
    await openSlotPicker('蓝方选人 2');
    await sleep(350);
    const slotStats = await pickerStats('选择英雄');
    const usedNames = ['狄仁杰', '孙尚香', '后羿', '马可波罗', '赵云',
      '瑶', '妲己', '安琪拉', '小乔', '甄姬', '廉颇', '张飞', '露娜', '孙膑', '张良'];
    const disabledUsed = (slotStats?.disabled || []).filter((n) => usedNames.includes(n));
    const enabledUsed = (slotStats?.enabled || []).filter((n) => usedNames.includes(n));
    rec('7.0 槽位选择器禁用已出场英雄（排除当前槽位自身）',
      { usedDisabled: 14, usedEnabled: ['孙尚香'], total: 133 },
      { usedDisabled: disabledUsed.length, usedEnabled: enabledUsed, total: slotStats?.total },
      disabledUsed.length === 14 && enabledUsed.length === 1 && enabledUsed[0] === '孙尚香'
        && slotStats?.total === 133,
      '已出场 15 个 - 当前槽位自身（孙尚香）1 个 = 14 个禁用');
    rec('7.1 当前槽位自身英雄可选（允许重选/覆盖）',
      { sunshangxiangDisabled: false },
      { sunshangxiangDisabled: (slotStats?.disabled || []).includes('孙尚香') },
      !(slotStats?.disabled || []).includes('孙尚香'));
    const clickUsed = await clickHero('狄仁杰'); // 已出场（bluePicks[0]）→ disabled
    await sleep(250);
    const stillOpen = (await pickerTitle()) === 'slot';
    rec('7.2 点击已出场的其他英雄无效（选择器仍开）',
      { clickFound: true, stillOpen: true }, { clickFound: clickUsed, stillOpen },
      clickUsed === true && stillOpen, '狄仁杰已被 bluePicks[0] 使用 → disabled=true');
    await shot('test_record_edit_slot_picker.png');
    await closePicker();
    await closeModalIfOpen();
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    await sleep(300);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  const total = RESULTS.length;
  const passed = RESULTS.filter((x) => x.pass).length;
  const failed = RESULTS.filter((x) => !x.pass && !x.incomplete);
  console.log('\n' + '='.repeat(78));
  console.log(`  记录编辑弹窗「我的英雄」测试: ${total} 项 / 通过 ${passed} / 失败 ${failed.length} / 待确认 ${INCOMPLETE.length}`);
  for (const x of INCOMPLETE) {
    console.log(`    [INCOMPLETE] ${x.item}: expect=${x.expected} actual=${x.actual}`);
    console.log(`                 ${x.note}`);
  }
  for (const x of failed) {
    console.log(`    [FAIL] ${x.item}: expect=${x.expected} actual=${x.actual}`);
  }
  console.log('='.repeat(78));
  fs.writeFileSync(
    path.join(OUT_DIR, 'test_record_edit.json'),
    JSON.stringify({
      generated: new Date().toISOString(), total, passed,
      failed: failed.length, incomplete: INCOMPLETE.length, records: RESULTS,
    }, null, 1),
  );
  console.log('明细: _diag/test_record_edit.json');
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});
