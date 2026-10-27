// 对 我方2 的检测圆 (43,119) 做局部搜索，看能否在附近找到「弈星」的最优位置
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
function circular(cv, mat, size) {
  const resized = new cv.Mat(); cv.resize(mat, resized, new cv.Size(size, size));
  const mask = cv.Mat.zeros(size, size, cv.CV_8UC1);
  cv.circle(mask, new cv.Point(size >> 1, size >> 1), size >> 1, new cv.Scalar(255), -1);
  const masked = new cv.Mat(); cv.bitwise_and(resized, resized, masked, mask);
  const out = new cv.Mat(); cv.resize(masked, out, new cv.Size(256, 256));
  resized.delete(); mask.delete(); masked.delete(); return out;
}

async function main() {
  const cv = await loadCv();
  const manifest = JSON.parse(fs.readFileSync('avatars/manifest.json', 'utf-8'));
  const ids = manifest.map((m) => m.id);
  const nameById = {}; manifest.forEach(m => nameById[m.id] = m.name);

  const orb = new cv.ORB(1000);
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const avDescs = {};
  for (const id of ids) {
    const mat = await imreadRgba(cv, 'avatars/' + id + '.jpg');
    const bgr = toBgr(cv, mat);
    const cir = circular(cv, bgr, 48);
    const kp = new cv.KeyPointVector(); const des = new cv.Mat();
    orb.detectAndCompute(cir, new cv.Mat(), kp, des);
    if (!des.empty()) avDescs[id] = des.clone();
    mat.delete(); bgr.delete(); cir.delete(); kp.delete(); des.delete();
  }

  const shot = await imreadRgba(cv, 'runtime-screenshot.png');
  const shotBgr = toBgr(cv, shot);
  const W = shotBgr.cols, H = shotBgr.rows;

  function matchAt(cx, cy, r) {
    const sz = Math.floor(r * 2.2);
    let x = Math.max(0, cx - (sz >> 1)); let y = Math.max(0, cy - (sz >> 1));
    x = Math.min(x, W - sz); y = Math.min(y, H - sz);
    const roi = shotBgr.roi(new cv.Rect(x, y, sz, sz));
    const cir = circular(cv, roi, sz);
    const kp = new cv.KeyPointVector(); const qdes = new cv.Mat();
    orb.detectAndCompute(cir, new cv.Mat(), kp, qdes);
    const scores = [];
    if (!qdes.empty()) for (const id of ids) {
      const matches = new cv.DMatchVectorVector();
      bf.knnMatch(qdes, avDescs[id], matches, 2);
      let good = 0;
      for (let j = 0; j < matches.size(); j++) {
        const pair = matches.get(j);
        if (pair.size() === 2 && pair.get(0).distance < 0.75 * pair.get(1).distance) good++;
      }
      if (good > 0) scores.push({ id, good });
      matches.delete();
    }
    scores.sort((a, b) => b.good - a.good);
    roi.delete(); cir.delete(); kp.delete(); qdes.delete();
    return scores;
  }

  // 在 (43,119) 周围搜索
  console.log('在 (43,119,r=23) 周围搜索（真实弈星在 61,113）：');
  for (const dy of [-24, -16, -8, 0, 8, 16]) {
    for (const dx of [-16, -8, 0, 8, 16, 24, 32]) {
      const cx = 43 + dx, cy = 119 + dy;
      const scores = matchAt(cx, cy, 23);
      const top = scores[0];
      const mark = top && top.id === 'yixing' ? '★弈星' : (top ? nameById[top.id] : '无');
      console.log(`  (${cx},${cy}) -> ${mark}(${top ? top.good : 0})${top && top.id === 'yixing' ? '  ← 命中!' : ''}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
