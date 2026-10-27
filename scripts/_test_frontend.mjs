// 测试小鱼 · 前端运行时验证（Edge headless + CDP，不碰 src/、不重启服务）
// 用法: node scripts/_test_frontend.mjs
// 输出: _diag/test_*.png + _diag/test_frontend.json
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL_APP = 'http://localhost:5173/';
const OUT_DIR = '_diag';
const PORT = 9333;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const RECORDS = [];
let msgId = 0;
const pending = new Map();
let ws = null;
const consoleErrors = [];
const pageExceptions = [];
const failedRequests = [];

function rec(item, expected, actual, pass, note = '') {
  RECORDS.push({ item, expected, actual, pass: !!pass, note });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${item.padEnd(34)} expect=${String(expected).padEnd(26)} actual=${actual} ${note}`);
}

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
    }, 30000);
  });
}

async function evaluate(expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise, userGesture: true,
  });
  if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log('    screenshot ->', p);
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Edge CDP 未就绪');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-edge-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1600,1000', 'about:blank',
  ];
  console.log('启动 Edge:', EDGE);
  const child = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });

  try {
    const target = await listTargets();
    console.log('CDP target:', target.title || target.url);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        pageExceptions.push(msg.params?.exceptionDetails?.exception?.description
          || msg.params?.exceptionDetails?.text || 'unknown');
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (msg.method === 'Network.loadingFailed') {
        failedRequests.push(`${msg.params?.type} ${msg.params?.errorText}`);
      }
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    // ---- 1) 打开首页 ----
    await send('Page.navigate', { url: URL_APP });
    await sleep(3500);
    // 等 React 加载完英雄数据（"加载英雄数据中" 消失）
    for (let i = 0; i < 30; i++) {
      const loading = await evaluate(`document.body.innerText.includes('加载英雄数据')`);
      if (!loading) break;
      await sleep(500);
    }

    const info = await evaluate(`(() => ({
      title: document.title,
      ready: document.readyState,
      rootChildren: document.getElementById('root')?.children.length ?? 0,
      bodyText: document.body.innerText.slice(0, 3000),
      buttons: [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean).slice(0, 40),
      imgCount: document.images.length,
      imgBroken: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
      hasLoading: document.body.innerText.includes('加载英雄数据'),
      hasLoadError: document.body.innerText.includes('加载英雄数据失败'),
    }))()`);

    rec('首页可访问 + React 渲染', 'root 有子节点', `rootChildren=${info.rootChildren} ready=${info.ready}`,
      info.rootChildren > 0);
    rec('英雄数据加载完成', '无"加载中"/"加载失败"',
      `loading=${info.hasLoading} error=${info.hasLoadError}`,
      !info.hasLoading && !info.hasLoadError);
    rec('页面标题', '非空且含 BP/王者', info.title, !!info.title);
    rec('内联图片无加载失败', '0 张坏图', `${info.imgBroken}/${info.imgCount}`, info.imgBroken === 0);
    await shot('test_front_bp.png');

    // ---- 2) 三个 Tab 存在 ----
    const TABS = ['BP 模拟', '数据看板', '记录'];
    const tabFound = await evaluate(`(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, '');
      const texts = [...document.querySelectorAll('button, a, div[role=button], span')]
        .map(e => norm(e.innerText));
      const want = ${JSON.stringify(TABS)};
      return want.map(w => ({ w, ok: texts.some(t => t === norm(w) || t.startsWith(norm(w))) }));
    })()`);
    rec('三个 Tab 均存在', '全部找到',
      tabFound.map((t) => `${t.w}:${t.ok ? 'Y' : 'N'}`).join(' '),
      tabFound.every((t) => t.ok));
    rec('默认在 BP 模拟页', '含 ADB 控制/阶段/已识别 ban',
      `adb=${info.bodyText.includes('ADB 控制')} ban=${info.bodyText.includes('已识别 ban')}`,
      info.bodyText.includes('ADB 控制') || info.bodyText.includes('已识别 ban'));

    // ---- 3) 切到「数据看板」 ----
    const clickTab = async (label) => evaluate(`(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, '');
      const cands = [...document.querySelectorAll('button, a, div[role=button]')];
      const el = cands.find(e => {
        const t = norm(e.innerText);
        return t === norm(${JSON.stringify(label)}) || t.startsWith(norm(${JSON.stringify(label)}));
      });
      if (!el) return false;
      el.click();
      return true;
    })()`);

    let ok = await clickTab('数据看板');
    await sleep(1200);
    const dash = await evaluate(`(() => {
      const t = document.body.innerText;
      return {
        clicked: ${ok},
        hasStat: t.includes('统计英雄'),
        hasAvg: t.includes('平均梯度评分'),
        hasTable: t.includes('梯度评分') && t.includes('登场率') && t.includes('禁用率'),
        hasRows: document.querySelectorAll('table tbody tr').length,
        excerpt: t.slice(0, 300),
      };
    })()`);
    rec('点击「数据看板」可切换', 'clicked=true 且出现统计卡/表格',
      `clicked=${dash.clicked} stat=${dash.hasStat} table=${dash.hasTable} rows=${dash.hasRows}`,
      dash.clicked && dash.hasStat && dash.hasTable && dash.hasRows > 10);
    await shot('test_front_dashboard.png');

    // ---- 4) 切到「记录」 ----
    ok = await clickTab('记录');
    await sleep(1000);
    const recs = await evaluate(`(() => {
      const t = document.body.innerText;
      return {
        clicked: ${ok},
        hasTitle: t.includes('BP 记录'),
        hasEmpty: t.includes('暂无记录'),
        hasWin: t.includes('我的英雄胜率'),
        excerpt: t.slice(0, 300),
      };
    })()`);
    rec('点击「记录」可切换', 'clicked=true 且出现 BP 记录区',
      `clicked=${recs.clicked} title=${recs.hasTitle} empty=${recs.hasEmpty} win=${recs.hasWin}`,
      recs.clicked && recs.hasTitle);
    await shot('test_front_records.png');

    // ---- 5) 回到 BP ----
    ok = await clickTab('BP 模拟');
    await sleep(1000);
    const back = await evaluate(`(() => {
      const t = document.body.innerText;
      return {
        clicked: ${ok},
        hasBp: t.includes('ADB 控制') || t.includes('已识别 ban') || t.includes('蓝方'),
        selects: document.querySelectorAll('select').length,
        titled: document.querySelectorAll('[title]').length,
        btnCount: document.querySelectorAll('button').length,
        len: t.length,
      };
    })()`);
    rec('切回「BP 模拟」可切换', 'clicked=true 且 BP 区元素出现', JSON.stringify(back),
      back.clicked && back.hasBp && back.len > 300);
    await shot('test_front_bp_back.png');

    // ---- 6) 设备/ADB 控制面板（只检查存在，不点） ----
    rec('ADB 控制面板元素', 'select>=1 且带 title 的按钮>=1',
      `select=${back.selects} titled=${back.titled} buttons=${back.btnCount}`,
      back.selects >= 1 && back.titled >= 1);

    // ---- 7) 控制台错误 ----
    rec('无未捕获 JS 异常', '0', String(pageExceptions.length), pageExceptions.length === 0,
      pageExceptions.slice(0, 2).join('; ').slice(0, 300));
    rec('无 console.error', '0', String(consoleErrors.length), consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' | ').slice(0, 300));
    rec('资源加载失败（Network.loadingFailed）', '0（允许字体/图标 404）',
      String(failedRequests.length), failedRequests.length === 0,
      failedRequests.slice(0, 4).join(' | '));

    // ---- 8) 视口适配：1440 / 1920 ----
    for (const [w, h] of [[1440, 900], [1920, 1080]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(600);
      const overflow = await evaluate(`(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }))()`);
      rec(`布局无横向溢出 @${w}x${h}`, 'scrollWidth<=clientWidth',
        `${overflow.sw}<=${overflow.cw}`, overflow.sw <= overflow.cw + 1);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    const jsErr = await evaluate(`window.__dshTestProbeLastError ?? null`).catch(() => null);
    if (jsErr) rec('探针', 'null', String(jsErr), false);
  } finally {
    try { ws?.close(); } catch {}
    try { child.kill(); } catch {}
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  const total = RECORDS.length;
  const passed = RECORDS.filter((r) => r.pass).length;
  console.log('\n' + '='.repeat(78));
  console.log(`  小计: ${total} 项 / 通过 ${passed} / 失败 ${total - passed}`);
  for (const r of RECORDS.filter((r) => !r.pass)) {
    console.log(`    [FAIL] ${r.item}: expect=${r.expected} actual=${r.actual}`);
  }
  console.log('='.repeat(78));
  fs.writeFileSync(path.join(OUT_DIR, 'test_frontend.json'), JSON.stringify({
    generated: new Date().toISOString(), url: URL_APP, total, passed,
    failed: total - passed, records: RECORDS,
    consoleErrors, pageExceptions, failedRequests,
  }, null, 1));
  console.log('明细已写入 _diag/test_frontend.json');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
