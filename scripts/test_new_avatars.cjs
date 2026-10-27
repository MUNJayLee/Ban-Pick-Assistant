// 验证：用 heroes.json 里的 mcxssg.net 头像（当前游戏在用）替换后，铠/关羽能否识别正确
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
  const heroes = JSON.parse(fs.readFileSync('src/data/heroes.json', 'utf8')).heroes;
  const id2url = {}; heroes.forEach(h => id2url[h.id] = h.avatar);
  const ids = manifest.map((m) => m.id);
  const nameById = {}; manifest.forEach(m => nameById[m.id] = m.name);

  const orb = new cv.ORB(1000);
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);

  // 只下载铠和关羽的新头像到内存，其余用老的
  const newAvatars = {};
  for (const id of ['kai', 'guanyu']) {
    const url = id2url[id];
    console.log(`下载 ${id}: ${url}`);
    const buf = await fetch(url).then(r => r.arrayBuffer());
    const p = '_tmp_new_' + id + '.png';
    fs.writeFileSync(p, Buffer.from(buf));
    const m = await sharp(p).metadata();
    console.log(`  -> ${m.width}x${m.height} format=${m.format}`);
    newAvatars[id] = p;
  }

  const avDescs = {};
  for (const id of ids) {
    const path = newAvatars[id] || ('avatars/' + id + '.jpg');
    const mat = await imreadRgba(cv, path);
    const bgr = toBgr(cv, mat);
    const cir = circular(cv, bgr, 48);
    const kp = new cv.KeyPointVector(); const des = new cv.Mat();
    orb.detectAndCompute(cir, new cv.Mat(), kp, des);
    if (!des.empty()) avDescs[id] = des.clone();
    mat.delete(); bgr.delete(); cir.delete(); kp.delete(); des.delete();
  }

  const shot = await imreadRgba(cv, '测试用例/62f73ca5e389165a91ac3fff2dab97a1.jpg');
  const shotBgr = toBgr(cv, shot);
  const W = shotBgr.cols, H = shotBgr.rows;

  function matchAll(cx, cy, r) {
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

  const s1 = matchAll(1551, 38, 21);
  console.log('\n敌方1(应为铠): top5 =', s1.slice(0, 5).map(s => `${nameById[s.id]}:${s.good}`).join(' '));
  const kaiRank = s1.findIndex(s => s.id === 'kai');
  console.log('  铠排名:', kaiRank < 0 ? '未进' : (kaiRank + 1), kaiRank >= 0 ? `分数 ${s1[kaiRank].good}` : '');

  const s2 = matchAll(1719, 37, 23);
  console.log('敌方4(应为关羽): top5 =', s2.slice(0, 5).map(s => `${nameById[s.id]}:${s.good}`).join(' '));
  const gyRank = s2.findIndex(s => s.id === 'guanyu');
  console.log('  关羽排名:', gyRank < 0 ? '未进' : (gyRank + 1), gyRank >= 0 ? `分数 ${s2[gyRank].good}` : '');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
