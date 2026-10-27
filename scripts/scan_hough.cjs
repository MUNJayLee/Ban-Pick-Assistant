// 扫描 HoughCircles 的 param2（累加器阈值）和 param1，看能否检测到正确的 (61,113)
const sharp = require('sharp');

async function main() {
  const mod = await require('@techstark/opencv-js');
  const cv = mod && mod.Mat ? mod : (await mod);
  await new Promise((r) => { if (cv.Mat) r(); else cv.onRuntimeInitialized = () => r(); });

  const { data, info } = await sharp('runtime-screenshot.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageData = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  const mat = cv.matFromImageData(imageData);
  const bgr = new cv.Mat(); cv.cvtColor(mat, bgr, cv.COLOR_RGBA2BGR);
  const gray = new cv.Mat(); cv.cvtColor(bgr, gray, cv.COLOR_BGR2GRAY);
  const H = gray.rows, W = gray.cols;
  const top = gray.roi(new cv.Rect(0, 0, W, Math.floor(H * 0.12)));

  const target = (x, y) => Math.abs(x - 61) < 8 && Math.abs(y - 113) < 8;
  const wrong = (x, y) => Math.abs(x - 43) < 8 && Math.abs(y - 119) < 8;

  // 扫描 param2 (20..35)，param1 固定 90，minDist 40, minR 17, maxR 32
  console.log('=== 扫描 param2（param1=90, minDist=40）===');
  for (let p2 = 20; p2 <= 35; p2++) {
    const cm = new cv.Mat();
    cv.HoughCircles(top, cm, cv.HOUGH_GRADIENT, 1.2, 40, 90, p2, 17, 32);
    let found = false, foundWrong = false, n = 0;
    if (!cm.empty()) for (let i = 0; i < cm.cols; i++) {
      const x = cm.data32F[i * 3], y = cm.data32F[i * 3 + 1], r = cm.data32F[i * 3 + 2];
      if (r >= 17 && (x < W * 0.35 || x > W * 0.65)) { n++; if (target(x, y)) found = true; if (wrong(x, y)) foundWrong = true; }
    }
    if (found || foundWrong) console.log(`param2=${p2}: 有效=${n} 命中(61,113)=${found} 命中(43,119)=${foundWrong}`);
    cm.delete();
  }

  // 扫描 param1（Canny 高阈值），param2 固定 22
  console.log('\n=== 扫描 param1（param2=22, minDist=40）===');
  for (let p1 = 60; p1 <= 130; p1 += 5) {
    const cm = new cv.Mat();
    cv.HoughCircles(top, cm, cv.HOUGH_GRADIENT, 1.2, 40, p1, 22, 17, 32);
    let found = false, foundWrong = false, n = 0;
    if (!cm.empty()) for (let i = 0; i < cm.cols; i++) {
      const x = cm.data32F[i * 3], y = cm.data32F[i * 3 + 1], r = cm.data32F[i * 3 + 2];
      if (r >= 17 && (x < W * 0.35 || x > W * 0.65)) { n++; if (target(x, y)) found = true; if (wrong(x, y)) foundWrong = true; }
    }
    if (found || foundWrong) console.log(`param1=${p1}: 有效=${n} 命中(61,113)=${found} 命中(43,119)=${foundWrong}`);
    cm.delete();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
