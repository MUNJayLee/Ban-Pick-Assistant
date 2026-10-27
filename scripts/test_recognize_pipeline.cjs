// 复刻「修复后」浏览器识别管线，在 Node 中验证能否复现 Python 的 10/10
const fs = require('fs');
const sharp = require('sharp');

async function loadCv() {
  const mod = await require('@techstark/opencv-js');
  const cv = mod && mod.Mat ? mod : (await mod);
  await new Promise((r) => { if (cv.Mat) r(); else cv.onRuntimeInitialized = () => r(); });
  return cv;
}

// 解码为 RGBA Mat（模拟浏览器 cv.imread 返回的 RGBA 4 通道）
async function imreadRgba(cv, path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageData = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  return cv.matFromImageData(imageData);
}

// 转灰度（正确处理 RGBA）
function toGray(cv, mat) {
  const ch = mat.channels();
  if (ch === 1) return mat.clone();
  const out = new cv.Mat();
  cv.cvtColor(mat, out, ch === 4 ? cv.COLOR_RGBA2GRAY : cv.COLOR_BGR2GRAY);
  return out;
}

// 转 BGR（复刻 Python cv2.imdecode 的 BGR 三通道）
function toBgr(cv, mat) {
  const ch = mat.channels();
  if (ch === 1) { const out = new cv.Mat(); cv.cvtColor(mat, out, cv.COLOR_GRAY2BGR); return out; }
  const out = new cv.Mat();
  cv.cvtColor(mat, out, ch === 4 ? cv.COLOR_RGBA2BGR : cv.COLOR_RGB2BGR);
  return out;
}

// 复刻 Python circular：resize 到 size -> 圆形掩码 -> resize 到 256
function circular(cv, mat, size) {
  const resized = new cv.Mat();
  cv.resize(mat, resized, new cv.Size(size, size));
  const mask = cv.Mat.zeros(size, size, cv.CV_8UC1);
  cv.circle(mask, new cv.Point(size >> 1, size >> 1), size >> 1, new cv.Scalar(255), -1);
  const masked = new cv.Mat();
  cv.bitwise_and(resized, resized, masked, mask);
  const out = new cv.Mat();
  cv.resize(masked, out, new cv.Size(256, 256));
  resized.delete(); mask.delete(); masked.delete();
  return out;
}

// 复刻 Python detect_circles：顶部 12% + 三组参数回退
function detectCircles(cv, shotGray) {
  const H = shotGray.rows, W = shotGray.cols;
  const top = shotGray.roi(new cv.Rect(0, 0, W, Math.floor(H * 0.12)));
  const params = [[50, 100, 30, 18, 30], [40, 90, 22, 17, 32], [40, 80, 15, 15, 34]];
  for (const [md, p1, p2, mnr, mxr] of params) {
    const circles = new cv.Mat();
    cv.HoughCircles(top, circles, cv.HOUGH_GRADIENT, 1.2, md, p1, p2, mnr, mxr);
    const valid = [];
    if (!circles.empty()) {
      for (let i = 0; i < circles.cols; i++) {
        const x = Math.round(circles.data32F[i * 3]);
        const y = Math.round(circles.data32F[i * 3 + 1]);
        const r = Math.round(circles.data32F[i * 3 + 2]);
        if (r >= 17 && (x < W * 0.35 || x > W * 0.65)) valid.push({ x, y, r });
      }
    }
    circles.delete();
    if (valid.length >= 10) {
      valid.sort((a, b) => a.x - b.x);
      top.delete();
      return [...valid.slice(0, 5), ...valid.slice(-5)];
    }
  }
  top.delete();
  return null;
}

async function main() {
  const cv = await loadCv();
  const manifest = JSON.parse(fs.readFileSync('avatars/manifest.json', 'utf-8'));
  const nameById = {};
  manifest.forEach((m) => { nameById[m.id] = m.name; });

  const orb = new cv.ORB(1000);
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);

  // 头像描述子（复刻 Python：BGR + circular(48) + ORB）
  const avDescs = {};
  for (const m of manifest) {
    const mat = await imreadRgba(cv, 'avatars/' + m.id + '.jpg');
    const bgr = toBgr(cv, mat);
    const cir = circular(cv, bgr, 48);
    const kp = new cv.KeyPointVector();
    const des = new cv.Mat();
    orb.detectAndCompute(cir, new cv.Mat(), kp, des);
    if (!des.empty()) avDescs[m.id] = des.clone();
    mat.delete(); bgr.delete(); cir.delete(); kp.delete(); des.delete();
  }
  console.log('avatars loaded:', Object.keys(avDescs).length);

  // 截图（复刻 Python：BGR + BGR2GRAY 用于圆检测）
  const shot = await imreadRgba(cv, 'runtime-screenshot.png');
  const shotBgr = toBgr(cv, shot);
  const shotGray = new cv.Mat();
  cv.cvtColor(shotBgr, shotGray, cv.COLOR_BGR2GRAY);
  const H = shotGray.rows, W = shotGray.cols;
  const circles = detectCircles(cv, shotGray);
  if (!circles) { console.log('NO CIRCLES'); return; }
  console.log('circles:', circles.length);

  const recognize = (cx, cy, r) => {
    const sz = Math.floor(r * 2.2);
    let x = Math.max(0, cx - (sz >> 1)); let y = Math.max(0, cy - (sz >> 1));
    x = Math.min(x, W - sz); y = Math.min(y, H - sz);
    const roi = shotBgr.roi(new cv.Rect(x, y, sz, sz));
    const cir = circular(cv, roi, sz);
    const kp = new cv.KeyPointVector();
    const qdes = new cv.Mat();
    orb.detectAndCompute(cir, new cv.Mat(), kp, qdes);
    const scores = [];
    if (!qdes.empty()) {
      for (const hid of Object.keys(avDescs)) {
        const matches = new cv.DMatchVectorVector();
        bf.knnMatch(qdes, avDescs[hid], matches, 2);
        let good = 0;
        for (let j = 0; j < matches.size(); j++) {
          const pair = matches.get(j);
          if (pair.size() === 2 && pair.get(0).distance < 0.75 * pair.get(1).distance) good++;
        }
        scores.push({ id: hid, score: good });
        matches.delete();
      }
    }
    scores.sort((a, b) => b.score - a.score);
    roi.delete(); cir.delete(); kp.delete(); qdes.delete();
    return scores;
  };

  const labels = ['我方1','我方2','我方3','我方4','我方5','敌方1','敌方2','敌方3','敌方4','敌方5'];
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const scores = recognize(c.x, c.y, c.r);
    const top = scores[0];
    console.log(labels[i], '=>', top ? `${top.id}(${nameById[top.id]}) score=${top.score}` : 'NONE',
      '| top3:', scores.slice(0, 3).map(s => `${s.id}:${s.score}`).join(' '));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
