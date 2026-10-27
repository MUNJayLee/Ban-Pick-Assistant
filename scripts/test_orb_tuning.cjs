// 用 cv2 的 10 个正确圆位置，隔离测试 ORB 匹配：不同 nfeatures + 打分方式下的准确率与领先幅度
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
const CIRCLES = [[43,41,25],[61,113,21],[85,61,22],[151,29,30],[197,31,31],[1375,43,26],[1423,37,29],[1435,115,23],[1471,43,26],[1481,115,17]];

async function main() {
  const cv = await loadCv();
  const manifest = JSON.parse(fs.readFileSync('avatars/manifest.json', 'utf-8'));
  const ids = manifest.map((m) => m.id);

  const shot = await imreadRgba(cv, 'runtime-screenshot.png');
  const shotBgr = toBgr(cv, shot);
  const W = shotBgr.cols, H = shotBgr.rows;

  for (const nfeat of [1000, 2000, 5000, 10000]) {
    const orb = new cv.ORB(nfeat);
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

    // 对每个正确圆，计算三种打分
    let accCount = 0, accWeight = 0, accRatio = 0;
    let marginCount = 0, marginWeight = 0, marginRatio = 0;
    const detail = [];
    for (let ci = 0; ci < CIRCLES.length; ci++) {
      const [cx, cy, r] = CIRCLES[ci];
      const sz = Math.floor(r * 2.2);
      let x = Math.max(0, cx - (sz >> 1)); let y = Math.max(0, cy - (sz >> 1));
      x = Math.min(x, W - sz); y = Math.min(y, H - sz);
      const roi = shotBgr.roi(new cv.Rect(x, y, sz, sz));
      const cir = circular(cv, roi, sz);
      const kp = new cv.KeyPointVector(); const qdes = new cv.Mat();
      orb.detectAndCompute(cir, new cv.Mat(), kp, qdes);

      const rows = [];
      if (!qdes.empty()) {
        for (const id of ids) {
          const matches = new cv.DMatchVectorVector();
          bf.knnMatch(qdes, avDescs[id], matches, 2);
          let count = 0, weight = 0, total = 0;
          for (let j = 0; j < matches.size(); j++) {
            const pair = matches.get(j);
            if (pair.size() === 2) {
              total++;
              const d0 = pair.get(0).distance, d1 = pair.get(1).distance;
              if (d0 < 0.75 * d1) {
                count++;
                weight += (1 - d0 / 256);
              }
            }
          }
          if (total > 0 || count > 0) {
            rows.push({ id, count, weight, ratio: total ? count / total : 0 });
          }
          matches.delete();
        }
      }
      const sortCount = [...rows].sort((a, b) => b.count - a.count);
      const sortWeight = [...rows].sort((a, b) => b.weight - a.weight);
      const sortRatio = [...rows].sort((a, b) => b.ratio - a.ratio);
      const m1 = sortCount[0], m2 = sortCount[1] || { count: 0 };
      const w1 = sortWeight[0], w2 = sortWeight[1] || { weight: 0 };
      const rr1 = sortRatio[0], rr2 = sortRatio[1] || { ratio: 0 };

      if (m1 && m1.id === GT[ci]) accCount++;
      if (w1 && w1.id === GT[ci]) accWeight++;
      if (rr1 && rr1.id === GT[ci]) accRatio++;
      marginCount += m1.count - m2.count;
      marginWeight += w1.weight - w2.weight;
      marginRatio += rr1.ratio - rr2.ratio;
      detail.push(`${GT[ci]} count=${m1.id}(${m1.count},d${m1.count - m2.count}) weight=${w1.id}(${w1.weight.toFixed(1)},d${(w1.weight - w2.weight).toFixed(1)})`);
      roi.delete(); cir.delete(); kp.delete(); qdes.delete();
    }
    console.log(`\n=== nfeatures=${nfeat} ===`);
    console.log('  count 打分: 准确率', accCount + '/10  平均领先', marginCount / 10);
    console.log('  weight打分: 准确率', accWeight + '/10  平均领先', (marginWeight / 10).toFixed(2));
    console.log('  ratio 打分: 准确率', accRatio + '/10  平均领先', (marginRatio / 10).toFixed(3));
    if (nfeat === 2000) detail.forEach(d => console.log('   ', d));
    orb.delete();
  }
  shotBgr.delete(); shot.delete();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
