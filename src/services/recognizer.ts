import cvModule from '@techstark/opencv-js';

type Cv = any;

let cv: Cv | null = null;

async function loadOpenCv(): Promise<Cv> {
  if (cv) return cv;
  const mod: any = cvModule;
  if (mod instanceof Promise) {
    cv = await mod;
  } else if (mod.Mat) {
    cv = mod;
  } else {
    await new Promise<void>((resolve) => {
      mod.onRuntimeInitialized = () => resolve();
    });
    cv = mod;
  }
  return cv;
}

/** 从 URL 加载 <img> 元素 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('加载图片失败 ' + url));
    img.src = url;
  });
}

/** 从 File 加载 <img> 元素 */
function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('读取截图失败'));
    img.src = url;
  });
}

/** 把 File 转成 base64（去掉 data URL 前缀），供本地 Python 识别服务使用 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** 本地 Python 识别服务地址（与「截图识别.mjs」8891 端口对应） */
const PY_SERVER = 'http://localhost:8891';

/** 走本地 Python cv2（10/10）：POST 截图 base64 到 /recognize，返回 {blue, red} */
async function recognizeBansViaPython(file: File): Promise<RecognizeBansResult> {
  const base64 = await fileToBase64(file);
  const resp = await fetch(`${PY_SERVER}/recognize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });
  if (!resp.ok) throw new Error('识别服务返回 ' + resp.status);
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  const mapResult = (r: any): RecognizeResult => ({
    heroId: r.hero_id || '',
    score: r.score || 0,
    candidates: (r.candidates || []).map((c: any) => ({ heroId: c.id, score: c.score })),
    pos: Array.isArray(r.pos) && r.pos.length === 3 ? { x: r.pos[0], y: r.pos[1], r: r.pos[2] } : undefined,
  });
  // Python 结果里 label「我方N」= 蓝方（左），「敌方N」= 红方（右）
  const all = (data.results || []) as any[];
  const blue = all.filter((r) => String(r.label || '').startsWith('我方')).map(mapResult);
  const red = all.filter((r) => String(r.label || '').startsWith('敌方')).map(mapResult);
  return { blue, red };
}

/**
 * 复刻 Python cv2 的颜色通道：浏览器 imread 返回 RGBA(4通道)，
 * 而 cv2.imdecode 是 BGR(3通道)。ORB 内部会自己把 BGR 转灰度，
 * 所以必须转成 BGR 交给 ORB，才能和 Python 描述子完全一致。
 */
function toBgr(c: Cv, mat: any): any {
  const ch = mat.channels();
  const out = new c.Mat();
  if (ch === 1) {
    c.cvtColor(mat, out, c.COLOR_GRAY2BGR);
  } else if (ch === 4) {
    c.cvtColor(mat, out, c.COLOR_RGBA2BGR);
  } else {
    c.cvtColor(mat, out, c.COLOR_RGB2BGR);
  }
  return out;
}

/**
 * 复刻 Python circular()：先 resize 到 size -> 圆形掩码 -> 再放大到 256。
 * 头像用 size=48（先缩到 48 再放大，模糊化以匹配游戏内小头像），ROI 用 size=sz。
 * 输出 256x256 的 BGR Mat（需调用方 delete）。
 */
function circular(c: Cv, mat: any, size: number): any {
  const resized = new c.Mat();
  c.resize(mat, resized, new c.Size(size, size));
  const mask = c.Mat.zeros(size, size, c.CV_8UC1);
  c.circle(mask, new c.Point(size >> 1, size >> 1), size >> 1, new c.Scalar(255), -1);
  const masked = new c.Mat();
  c.bitwise_and(resized, resized, masked, mask);
  const out = new c.Mat();
  c.resize(masked, out, new c.Size(256, 256));
  resized.delete();
  mask.delete();
  masked.delete();
  return out;
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

/**
 * 复刻 Python detect_circles：顶部 12% 区域 + 三组参数回退 + 圆坐标取整。
 * 支持「空 ban」：左右两侧各自返回 0-5 个圆（不足 5 个即为有空 ban）。
 */
function detectCircles(c: Cv, shotBgr: any): { left: Circle[]; right: Circle[] } | null {
  const H = shotBgr.rows;
  const W = shotBgr.cols;
  const gray = new c.Mat();
  c.cvtColor(shotBgr, gray, c.COLOR_BGR2GRAY);
  const top = gray.roi(new c.Rect(0, 0, W, Math.floor(H * 0.12)));

  const params: [number, number, number, number, number][] = [
    [50, 100, 30, 18, 30],
    [40, 90, 22, 17, 32],
    [40, 80, 15, 15, 34],
    [70, 80, 15, 30, 60],    // 2K 高分屏
    [120, 80, 15, 55, 110],  // 4K 高分屏
  ];

  let bestLeft: Circle[] = [];
  let bestRight: Circle[] = [];
  for (const [md, p1, p2, mnr, mxr] of params) {
    const circles = new c.Mat();
    c.HoughCircles(top, circles, c.HOUGH_GRADIENT, 1.2, md, p1, p2, mnr, mxr);
    const left: Circle[] = [];
    const right: Circle[] = [];
    if (!circles.empty()) {
      for (let i = 0; i < circles.cols; i++) {
        // 关键：先取整（Python 用 np.uint16(np.around(...))），否则 ROI 会偏 1px
        const x = Math.round(circles.data32F[i * 3]);
        const y = Math.round(circles.data32F[i * 3 + 1]);
        const r = Math.round(circles.data32F[i * 3 + 2]);
        if (r < 17) continue;
        if (x < W * 0.35) left.push({ x, y, r });
        else if (x > W * 0.65) right.push({ x, y, r });
      }
    }
    circles.delete();
    left.sort((a, b) => a.x - b.x);
    right.sort((a, b) => a.x - b.x);
    const L = left.slice(0, 5);
    const R = right.slice(-5);
    if (L.length + R.length > bestLeft.length + bestRight.length) {
      bestLeft = L;
      bestRight = R;
    }
    // 双方都检测满 5 个即可停止，避免更宽松参数引入更多误检
    if (L.length >= 5 && R.length >= 5) break;
  }
  gray.delete();
  top.delete();
  if (bestLeft.length + bestRight.length === 0) return null;
  return { left: bestLeft, right: bestRight };
}

let orb: any = null;
let bf: any = null;
let avatarDescs: { id: string; des: any }[] = [];

/** 初始化：加载英雄头像模板并计算 ORB 描述子（BGR + circular(48)，数量随 heroes.json 动态变化） */
export async function initRecognizer(heroIds: string[]): Promise<void> {
  const c = await loadOpenCv();
  orb = new c.ORB(1000);
  bf = new c.BFMatcher(c.NORM_HAMMING, false);
  avatarDescs = [];
  for (const id of heroIds) {
    try {
      const img = await loadImage(`/avatars/${id}.jpg`);
      const mat = c.imread(img);
      const bgr = toBgr(c, mat);
      const masked = circular(c, bgr, 48);
      const kp = new c.KeyPointVector();
      const des = new c.Mat();
      orb.detectAndCompute(masked, new c.Mat(), kp, des);
      if (!des.empty()) avatarDescs.push({ id, des: des.clone() });
      mat.delete();
      bgr.delete();
      masked.delete();
      kp.delete();
      des.delete();
    } catch (e) {
      console.warn('[recognizer] 头像加载失败', id, e);
    }
  }
}

export interface RecognizeResult {
  heroId: string;
  score: number;
  candidates: { heroId: string; score: number }[];
  /** 圆位置（截图像素坐标），用于裁剪训练样本 */
  pos?: { x: number; y: number; r: number };
}

export interface RecognizeBansResult {
  blue: RecognizeResult[];
  red: RecognizeResult[];
}

/** WASM（OpenCV.js）识别：自包含，不依赖本地服务。 */
async function recognizeBansViaWasm(file: File): Promise<RecognizeBansResult> {
  const c = await loadOpenCv();
  if (!orb || avatarDescs.length === 0) throw new Error('识别器未初始化，请先调用 initRecognizer');

  const img = await fileToImage(file);
  const shot = c.imread(img);
  const shotBgr = toBgr(c, shot);
  const H = shotBgr.rows;
  const W = shotBgr.cols;

  const slots = detectCircles(c, shotBgr);
  if (!slots || slots.left.length + slots.right.length === 0) {
    shot.delete();
    shotBgr.delete();
    throw new Error('未识别到任何 ban 头像（请确认是 ban 阶段结束的截图）');
  }

  const recognizeCircle = (circ: Circle, used: Set<string>): RecognizeResult => {
    const sz = Math.floor(circ.r * 2.2);
    let x = Math.max(0, circ.x - (sz >> 1));
    let y = Math.max(0, circ.y - (sz >> 1));
    x = Math.min(x, W - sz);
    y = Math.min(y, H - sz);
    const roi = shotBgr.roi(new c.Rect(x, y, sz, sz));
    const masked = circular(c, roi, sz);
    const kp = new c.KeyPointVector();
    const qdes = new c.Mat();
    orb.detectAndCompute(masked, new c.Mat(), kp, qdes);

    const scores: { heroId: string; score: number }[] = [];
    if (!qdes.empty()) {
      for (const av of avatarDescs) {
        const matches = new c.DMatchVectorVector();
        bf.knnMatch(qdes, av.des, matches, 2);
        let good = 0;
        for (let j = 0; j < matches.size(); j++) {
          const pair = matches.get(j);
          if (pair.size() === 2 && pair.get(0).distance < 0.75 * pair.get(1).distance) good++;
        }
        if (good > 0) scores.push({ heroId: av.id, score: good });
        matches.delete();
      }
    }
    scores.sort((a, b) => b.score - a.score);
    // 去重：同一阵营内英雄不可重复 ban，选第一个未被本方使用过的英雄
    const top = scores.find((s) => !used.has(s.heroId)) ?? scores[0];
    if (top) used.add(top.heroId);
    const result: RecognizeResult = {
      heroId: top?.heroId ?? '',
      score: top?.score ?? 0,
      candidates: scores.slice(0, 5),
      pos: { x: circ.x, y: circ.y, r: circ.r },
    };

    roi.delete();
    masked.delete();
    kp.delete();
    qdes.delete();
    return result;
  };

  const usedBlue = new Set<string>();
  const usedRed = new Set<string>();
  const blue = slots.left.map((c) => recognizeCircle(c, usedBlue));
  const red = slots.right.map((c) => recognizeCircle(c, usedRed));

  shot.delete();
  shotBgr.delete();
  return { blue, red };
}

/**
 * 识别截图 ban 位（双引擎自动回退）：
 * 1. 优先走本地 Python cv2（更准，已验证 10/10）；
 * 2. 本地服务不可用或识别失败时，回退到浏览器内置 WASM 识别。
 * 返回 { blue, red } 两侧各自的识别结果（各 0-5 个，支持空 ban）。
 */
export async function recognizeBans(file: File): Promise<RecognizeBansResult> {
  try {
    return await recognizeBansViaPython(file);
  } catch (e) {
    console.warn('[recognizer] 本地 Python 识别不可用，回退 WASM：', e);
    return recognizeBansViaWasm(file);
  }
}
