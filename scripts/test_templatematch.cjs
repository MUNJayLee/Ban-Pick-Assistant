// 验证模板匹配（TM_CCOEFF_NORMED）在 ban 头像识别上的区分度
const fs = require('fs');
const sharp = require('sharp');

async function loadCv() {
  const mod = await require('@techstark/opencv-js');
  const cv = mod && mod.Mat ? mod : (await mod);
  await new Promise((r) => { if (cv.Mat) r(); else cv.onRuntimeInitialized = () => r(); });
  return cv;
}

async function imreadRgba(cv, path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageData = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  return cv.matFromImageData(imageData);
}

function toBgr(cv, mat) {
  const out = new cv.Mat();
  cv.cvtColor(mat, out, mat.channels() === 4 ? cv.COLOR_RGBA2BGR : cv.COLOR_RGB2BGR);
  return out;
}

// 圆形掩码 + 缩放到规范尺寸（64x64 灰）
function normalize(cv, mat, targetSize) {
  const sz = targetSize || 64;
  const resized = new cv.Mat();
  cv.resize(mat, resized, new cv.Size(sz, sz));
  const mask = cv.Mat.zeros(sz, sz, cv.CV_8UC1);
  cv.circle(mask, new cv.Point(sz >> 1, sz >> 1), sz >> 1, new cv.Scalar(255), -1);
  const masked = new cv.Mat();
  cv.bitwise_and(resized, resized, masked, mask);
  const gray = new cv.Mat();
  cv.cvtColor(masked, gray, cv.COLOR_BGR2GRAY);
  resized.delete(); mask.delete(); masked.delete();
  return gray;
}

async function main() {
  const cv = await loadCv();
  const manifest = JSON.parse(fs.readFileSync('avatars/manifest.json', 'utf-8'));
  const nameById = {}; manifest.forEach((m) => { nameById[m.id] = m.name; });

  // 头像规范化（64x64 灰）
  const avMats = {};
  for (const m of manifest) {
    const mat = await imreadRgba(cv, 'avatars/' + m.id + '.jpg');
    const bgr = toBgr(cv, mat);
    avMats[m.id] = normalize(cv, bgr, 64);
    mat.delete(); bgr.delete();
  }
  console.log('avatars:', Object.keys(avMats).length);

  // 截图 + 圆检测（同前）
  const shot = await imreadRgba(cv, 'runtime-screenshot.png');
  const shotBgr = toBgr(cv, shot);
  const shotGray = new cv.Mat(); cv.cvtColor(shotBgr, shotGray, cv.COLOR_BGR2GRAY);
  const H = shotGray.rows, W = shotGray.cols;
  const top = shotGray.roi(new cv.Rect(0, 0, W, Math.floor(H * 0.12)));
  const params = [[50, 100, 30, 18, 30], [40, 90, 22, 17, 32], [40, 80, 15, 15, 34]];
  let circles = null;
  for (const [md, p1, p2, mnr, mxr] of params) {
    const cm = new cv.Mat();
    cv.HoughCircles(top, cm, cv.HOUGH_GRADIENT, 1.2, md, p1, p2, mnr, mxr);
    const valid = [];
    if (!cm.empty()) for (let i = 0; i < cm.cols; i++) {
      const x = cm.data32F[i * 3], y = cm.data32F[i * 3 + 1], r = cm.data32F[i * 3 + 2];
      if (r >= 17 && (x < W * 0.35 || x > W * 0.65)) valid.push({ x, y, r });
    }
    cm.delete();
    if (valid.length >= 10) { valid.sort((a, b) => a.x - b.x); circles = [...valid.slice(0, 5), ...valid.slice(-5)]; break; }
  }
  top.delete();
  if (!circles) { console.log('NO CIRCLES'); return; }
  console.log('circles:', circles.length);

  // 对每个圆做模板匹配
  const labels = ['我方1','我方2','我方3','我方4','我方5','敌方1','敌方2','敌方3','敌方4','敌方5'];
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const sz = Math.floor(c.r * 2.2);
    let x = Math.max(0, c.x - (sz >> 1)); let y = Math.max(0, c.y - (sz >> 1));
    x = Math.min(x, W - sz); y = Math.min(y, H - sz);
    const roi = shotBgr.roi(new cv.Rect(x, y, sz, sz));
    const roiN = normalize(cv, roi, 64);

    const scores = [];
    for (const hid of Object.keys(avMats)) {
      const result = new cv.Mat();
      cv.matchTemplate(roiN, avMats[hid], result, cv.TM_CCOEFF_NORMED);
      scores.push({ id: hid, score: result.data32F[0] });
      result.delete();
    }
    scores.sort((a, b) => b.score - a.score);
    console.log(labels[i], '=>', `${scores[0].id}(${nameById[scores[0].id]}) ${scores[0].score.toFixed(3)}`,
      '| top3:', scores.slice(0, 3).map(s => `${s.id}:${s.score.toFixed(3)}`).join(' '));
    roi.delete(); roiN.delete();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
