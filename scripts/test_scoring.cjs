// 用已知参考答案，对比不同打分方法（ORB / 颜色直方图 / 组合）的 top-1 准确率
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
// 复刻 Python circular：resize->size 掩码 -> resize 256
function circular(cv, mat, size) {
  const resized = new cv.Mat(); cv.resize(mat, resized, new cv.Size(size, size));
  const mask = cv.Mat.zeros(size, size, cv.CV_8UC1);
  cv.circle(mask, new cv.Point(size >> 1, size >> 1), size >> 1, new cv.Scalar(255), -1);
  const masked = new cv.Mat(); cv.bitwise_and(resized, resized, masked, mask);
  const out = new cv.Mat(); cv.resize(masked, out, new cv.Size(256, 256));
  resized.delete(); mask.delete(); masked.delete(); return out;
}

const GT = ['xiangyu','yixing','cang','yuanliuzhizi_support','niumo','lixin','yunzhongjun','cang','zhugeliang','caocao'];

async function main() {
  const cv = await loadCv();
  const manifest = JSON.parse(fs.readFileSync('avatars/manifest.json', 'utf-8'));
  const ids = manifest.map((m) => m.id);

  const orb = new cv.ORB(1000);
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);

  // 头像：BGR + circular(48) + ORB 描述子 + HSV 直方图
  const avOrb = {}, avHist = {};
  for (const id of ids) {
    const mat = await imreadRgba(cv, 'avatars/' + id + '.jpg');
    const bgr = toBgr(cv, mat);
    const cir = circular(cv, bgr, 48);
    const kp = new cv.KeyPointVector(); const des = new cv.Mat();
    orb.detectAndCompute(cir, new cv.Mat(), kp, des);
    if (!des.empty()) avOrb[id] = des.clone();

    // HSV 直方图（在圆形 256 图上）
    const hsv = new cv.Mat(); cv.cvtColor(cir, hsv, cv.COLOR_BGR2HSV);
    const mask = cv.Mat.zeros(256, 256, cv.CV_8UC1);
    cv.circle(mask, new cv.Point(128, 128), 128, new cv.Scalar(255), -1);
    const hist = new cv.Mat();
    const mv = new cv.MatVector(); mv.push_back(hsv);
    cv.calcHist(mv, [0, 1], mask, hist, [16, 16], [0, 180, 0, 256]);
    cv.normalize(hist, hist, 0, 1, cv.NORM_MINMAX);
    mv.delete();
    avHist[id] = hist.clone();
    mat.delete(); bgr.delete(); cir.delete(); kp.delete(); des.delete(); hsv.delete(); mask.delete(); hist.delete();
  }
  console.log('avatars:', Object.keys(avOrb).length);

  // 截图
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

  // 对每个圆计算三种打分
  const methods = { orb: [], orbRatio: [], hist: [], combo: [] };
  const scoresPer = [];
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const sz = Math.floor(c.r * 2.2);
    let x = Math.max(0, c.x - (sz >> 1)); let y = Math.max(0, c.y - (sz >> 1));
    x = Math.min(x, W - sz); y = Math.min(y, H - sz);
    const roi = shotBgr.roi(new cv.Rect(x, y, sz, sz));
    const cir = circular(cv, roi, sz);
    const kp = new cv.KeyPointVector(); const qdes = new cv.Mat();
    orb.detectAndCompute(cir, new cv.Mat(), kp, qdes);
    // ROI HSV 直方图
    const hsv = new cv.Mat(); cv.cvtColor(cir, hsv, cv.COLOR_BGR2HSV);
    const hmask = cv.Mat.zeros(256, 256, cv.CV_8UC1);
    cv.circle(hmask, new cv.Point(128, 128), 128, new cv.Scalar(255), -1);
    const qhist = new cv.Mat();
    const qmv = new cv.MatVector(); qmv.push_back(hsv);
    cv.calcHist(qmv, [0, 1], hmask, qhist, [16, 16], [0, 180, 0, 256]);
    cv.normalize(qhist, qhist, 0, 1, cv.NORM_MINMAX);
    qmv.delete();

    const row = { orb: [], hist: [], orbRatio: [] };
    for (const id of ids) {
      let good = 0, total = 0;
      if (!qdes.empty() && avOrb[id]) {
        const matches = new cv.DMatchVectorVector();
        bf.knnMatch(qdes, avOrb[id], matches, 2);
        for (let j = 0; j < matches.size(); j++) {
          const pair = matches.get(j);
          if (pair.size() === 2) { total++; if (pair.get(0).distance < 0.75 * pair.get(1).distance) good++; }
        }
        matches.delete();
      }
      row.orb.push({ id, score: good });
      row.orbRatio.push({ id, score: total ? good / total : 0 });
      const corr = cv.compareHist(qhist, avHist[id], cv.HISTCMP_CORREL);
      row.hist.push({ id, score: corr });
    }
    row.orb.sort((a, b) => b.score - a.score);
    row.orbRatio.sort((a, b) => b.score - a.score);
    row.hist.sort((a, b) => b.score - a.score);
    // 组合：归一化 orb + hist
    const norm = (arr) => { const mx = Math.max(...arr.map(v => v.score), 1e-6); arr.forEach(v => v.n = v.score / mx); };
    norm(row.orb); norm(row.hist);
    const combo = ids.map(id => {
      const o = row.orb.find(v => v.id === id).n, h = row.hist.find(v => v.id === id).n;
      return { id, score: o * 0.5 + h * 0.5 };
    }).sort((a, b) => b.score - a.score);
    scoresPer.push({ gt: GT[i], orb: row.orb[0].id, orbRatio: row.orbRatio[0].id, hist: row.hist[0].id, combo: combo[0].id });
    console.log(`#${i} GT=${GT[i]} orb=${row.orb[0].id}(${row.orb[0].score}) ratio=${row.orbRatio[0].id} hist=${row.hist[0].id}(${row.hist[0].score.toFixed(2)}) combo=${combo[0].id}`);

    roi.delete(); cir.delete(); kp.delete(); qdes.delete(); hsv.delete(); hmask.delete(); qhist.delete();
  }

  const acc = (k) => scoresPer.filter(s => s[k] === s.gt).length;
  console.log('\nACCURACY orb:', acc('orb'), '/10');
  console.log('ACCURACY orbRatio:', acc('orbRatio'), '/10');
  console.log('ACCURACY hist:', acc('hist'), '/10');
  console.log('ACCURACY combo:', acc('combo'), '/10');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
