// 测试对顶部区域缩放后跑 HoughCircles，看能否检测到 (61,113)
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

  const target = (x, y, scale) => Math.abs(x - 61 * scale) < 8 * scale && Math.abs(y - 113 * scale) < 8 * scale;

  const tryScale = (label, scale, params) => {
    const tw = Math.floor(W * scale), th = Math.floor(H * 0.12 * scale);
    const scaled = new cv.Mat();
    cv.resize(gray, scaled, new cv.Size(tw, Math.floor(H * scale)));
    const top = scaled.roi(new cv.Rect(0, 0, tw, th));
    const cm = new cv.Mat();
    cv.HoughCircles(top, cm, cv.HOUGH_GRADIENT, 1.2, params[0] * scale, params[1], params[2], params[3] * scale, params[4] * scale);
    let found = false, n = 0, leftList = [];
    if (!cm.empty()) for (let i = 0; i < cm.cols; i++) {
      const x = cm.data32F[i * 3], y = cm.data32F[i * 3 + 1], r = cm.data32F[i * 3 + 2];
      if (r >= 17 * scale && (x < tw * 0.35 || x > tw * 0.65)) {
        n++;
        if (x < tw * 0.35) leftList.push(`(${Math.round(x)},${Math.round(y)},${Math.round(r)})`);
        if (target(x, y, scale)) found = true;
      }
    }
    console.log(label, '=> 有效', n, '| 命中(61,113):', found, '| left:', leftList.join(' '));
    cm.delete(); top.delete(); scaled.delete();
  };

  // 原始 scale=1
  tryScale('scale=1.0', 1.0, [40, 90, 22, 17, 32]);
  // 放大 2x（minDist 等按比例放大）
  tryScale('scale=2.0', 2.0, [80, 90, 22, 34, 64]);
  // 放大 3x
  tryScale('scale=3.0', 3.0, [120, 90, 22, 51, 96]);
  // 缩小 0.5x
  tryScale('scale=0.5', 0.5, [20, 90, 22, 9, 16]);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
