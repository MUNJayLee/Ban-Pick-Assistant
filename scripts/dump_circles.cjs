// 输出 WASM HoughCircles 检测到的圆位置，对照 Python
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
  let circles = null;
  for (const [md, p1, p2, mnr, mxr] of params) {
    const cm = new cv.Mat();
    cv.HoughCircles(top, cm, cv.HOUGH_GRADIENT, 1.2, md, p1, p2, mnr, mxr);
    const valid = [];
    if (!cm.empty()) for (let i = 0; i < cm.cols; i++) {
      const x = cm.data32F[i * 3], y = cm.data32F[i * 3 + 1], r = cm.data32F[i * 3 + 2];
      if (r >= 17 && (x < W * 0.35 || x > W * 0.65)) valid.push({ x, y, r });
    }
    console.log(`params(${md},${p1},${p2},${mnr},${mxr}): raw=${cm.cols} valid=${valid.length}`);
    cm.delete();
    if (valid.length >= 10) { valid.sort((a, b) => a.x - b.x); circles = [...valid.slice(0, 5), ...valid.slice(-5)]; break; }
  }
  top.delete();
  if (circles) {
    circles.forEach((c, i) => console.log(i, `(${c.x.toFixed(1)}, ${c.y.toFixed(1)}, r=${c.r.toFixed(1)})`));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
