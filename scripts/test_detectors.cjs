// 对比 ORB / AKAZE / BRISK 三种特征算子的 top-1 准确率
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

const GT = ['xiangyu','yixing','cang','yuanliuzhizi_support','niumo','lixin','yunzhongjun','cang','zhugeliang','caocao'];

async function runDetector(cv, kind) {
  let det, norm;
  if (kind === 'orb') { det = new cv.ORB(1000); norm = cv.NORM_HAMMING; }
  else if (kind === 'akaze') { det = new cv.AKAZE(); norm = cv.NORM_HAMMING; }
  else if (kind === 'brisk') { det = new cv.BRISK(); norm = cv.NORM_HAMMING; }
  else return { acc: 0, det: null };
  const bf = new cv.BFMatcher(norm, false);

  const manifest = JSON.parse(fs.readFileSync('avatars/manifest.json', 'utf-8'));
  const ids = manifest.map((m) => m.id);
  const avDescs = {};
  for (const id of ids) {
    const mat = await imreadRgba(cv, 'avatars/' + id + '.jpg');
    const bgr = toBgr(cv, mat);
    const cir = circular(cv, bgr, 48);
    const kp = new cv.KeyPointVector(); const des = new cv.Mat();
    det.detectAndCompute(cir, new cv.Mat(), kp, des);
    if (!des.empty()) avDescs[id] = des.clone();
    mat.delete(); bgr.delete(); cir.delete(); kp.delete(); des.delete();
  }

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

  let correct = 0;
  const details = [];
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const sz = Math.floor(c.r * 2.2);
    let x = Math.max(0, c.x - (sz >> 1)); let y = Math.max(0, c.y - (sz >> 1));
    x = Math.min(x, W - sz); y = Math.min(y, H - sz);
    const roi = shotBgr.roi(new cv.Rect(x, y, sz, sz));
    const cir = circular(cv, roi, sz);
    const kp = new cv.KeyPointVector(); const qdes = new cv.Mat();
    det.detectAndCompute(cir, new cv.Mat(), kp, qdes);
    let best = { id: '', score: -1 };
    if (!qdes.empty()) {
      for (const id of ids) {
        const matches = new cv.DMatchVectorVector();
        bf.knnMatch(qdes, avDescs[id], matches, 2);
        let good = 0;
        for (let j = 0; j < matches.size(); j++) {
          const pair = matches.get(j);
          if (pair.size() === 2 && pair.get(0).distance < 0.75 * pair.get(1).distance) good++;
        }
        if (good > best.score) best = { id, score: good };
        matches.delete();
      }
    }
    const ok = best.id === GT[i];
    if (ok) correct++;
    details.push(`${GT[i]} -> ${best.id}(${best.score})${ok ? ' OK' : ''}`);
    roi.delete(); cir.delete(); kp.delete(); qdes.delete();
  }
  return { acc: correct, det, details };
}

async function main() {
  const cv = await loadCv();
  for (const kind of ['orb', 'akaze', 'brisk']) {
    const r = await runDetector(cv, kind);
    console.log(`\n=== ${kind} === acc ${r.acc}/10`);
    r.details.forEach((d) => console.log(' ', d));
    if (r.det) r.det.delete();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
