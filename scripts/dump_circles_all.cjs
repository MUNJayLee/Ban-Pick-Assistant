// 输出 WASM 三档参数检测到的全部圆（含左右分组），用于定位我方2 的圆差异
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

  const params = [[50, 100, 30, 18, 30], [40, 90, 22, 17, 32], [40, 80, 15, 15, 34]];
  for (const [md, p1, p2, mnr, mxr] of params) {
    const cm = new cv.Mat();
    cv.HoughCircles(top, cm, cv.HOUGH_GRADIENT, 1.2, md, p1, p2, mnr, mxr);
    const raw = cm.cols;
    const all = [];
    if (!cm.empty()) for (let i = 0; i < cm.cols; i++) {
      const x = Math.round(cm.data32F[i * 3]);
      const y = Math.round(cm.data32F[i * 3 + 1]);
      const r = Math.round(cm.data32F[i * 3 + 2]);
      if (r >= 17 && (x < W * 0.35 || x > W * 0.65)) all.push({ x, y, r });
    }
    cm.delete();
    all.sort((a, b) => a.x - b.x);
    console.log(`\nparams(${md},${p1},${p2},${mnr},${mxr}): raw=${raw} valid=${all.length}`);
    console.log('  left:', all.filter(c => c.x < W * 0.35).map(c => `(${c.x},${c.y},r=${c.r})`).join(' '));
    console.log('  right:', all.filter(c => c.x > W * 0.65).map(c => `(${c.x},${c.y},r=${c.r})`).join(' '));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
