// 轮廓法检测圆：阈值化 + findContours + minEnclosingCircle，对比 HoughCircles 结果
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

  // 多种阈值策略
  const tryThreshold = (label, thresh) => {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const circles = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < 200) continue;
      const center = new cv.Point();
      const radius = new cv.Point(); // 会变成 {x, y}? 用对象
      // minEnclosingCircle(points, center, radius) — radius 是引用输出
      cv.minEnclosingCircle(cnt, center, radius);
      const r = radius.x !== undefined ? radius.x : radius;
      if (r >= 15 && r <= 36 && (center.x < W * 0.35 || center.x > W * 0.65)) {
        circles.push({ x: Math.round(center.x), y: Math.round(center.y), r: Math.round(r) });
      }
      cnt.delete();
    }
    contours.delete(); hierarchy.delete();
    circles.sort((a, b) => a.x - b.x);
    const left = circles.filter(c => c.x < W * 0.35);
    console.log(label, '=> 总数', circles.length, 'left:', left.map(c => `(${c.x},${c.y},r=${c.r})`).join(' '),
      '| 命中(61,113):', left.some(c => target(c.x, c.y)), '命中(43,119):', left.some(c => wrong(c.x, c.y)));
  };

  // 1. Otsu 二值化
  const otsu = new cv.Mat();
  cv.threshold(top, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  tryThreshold('OTSU', otsu);
  otsu.delete();

  // 2. 自适应阈值
  const adapt = new cv.Mat();
  cv.adaptiveThreshold(top, adapt, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 51, 5);
  tryThreshold('ADAPTIVE', adapt);
  adapt.delete();

  // 3. Canny 边缘
  const canny = new cv.Mat();
  cv.Canny(top, canny, 60, 150);
  tryThreshold('CANNY', canny);
  canny.delete();

  // 4. Canny + 闭运算
  const canny2 = new cv.Mat();
  cv.Canny(top, canny2, 60, 150);
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  const closed = new cv.Mat();
  cv.morphologyEx(canny2, closed, cv.MORPH_CLOSE, kernel);
  tryThreshold('CANNY+CLOSE', closed);
  canny2.delete(); kernel.delete(); closed.delete();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
