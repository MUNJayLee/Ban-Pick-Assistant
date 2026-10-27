// 测试在不同颜色通道上跑 HoughCircles，看能否检测到正确的 (61,113)
const sharp = require('sharp');

async function main() {
  const mod = await require('@techstark/opencv-js');
  const cv = mod && mod.Mat ? mod : (await mod);
  await new Promise((r) => { if (cv.Mat) r(); else cv.onRuntimeInitialized = () => r(); });

  const { data, info } = await sharp('runtime-screenshot.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageData = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  const mat = cv.matFromImageData(imageData);
  const bgr = new cv.Mat(); cv.cvtColor(mat, bgr, cv.COLOR_RGBA2BGR);
  const W = bgr.cols, H = bgr.rows;

  const target = (x, y) => Math.abs(x - 61) < 8 && Math.abs(y - 113) < 8;
  const wrong = (x, y) => Math.abs(x - 43) < 8 && Math.abs(y - 119) < 8;

  const testChannel = (label, chanFull) => {
    const top = chanFull.roi(new cv.Rect(0, 0, W, Math.floor(H * 0.12)));
    const cm = new cv.Mat();
    cv.HoughCircles(top, cm, cv.HOUGH_GRADIENT, 1.2, 40, 90, 22, 17, 32);
    let found = false, foundWrong = false, n = 0, leftList = [];
    if (!cm.empty()) for (let i = 0; i < cm.cols; i++) {
      const x = Math.round(cm.data32F[i * 3]), y = Math.round(cm.data32F[i * 3 + 1]), r = Math.round(cm.data32F[i * 3 + 2]);
      if (r >= 17 && (x < W * 0.35 || x > W * 0.65)) {
        n++;
        if (x < W * 0.35) leftList.push(`(${x},${y},${r})`);
        if (target(x, y)) found = true;
        if (wrong(x, y)) foundWrong = true;
      }
    }
    console.log(label, '=> 有效', n, '| 命中(61,113):', found, '| 命中(43,119):', foundWrong, '| left:', leftList.join(' '));
    cm.delete(); top.delete();
  };

  // 灰度
  const gray = new cv.Mat(); cv.cvtColor(bgr, gray, cv.COLOR_BGR2GRAY);
  testChannel('灰度', gray);

  // HSV 饱和度 / 明度
  const hsv = new cv.Mat(); cv.cvtColor(bgr, hsv, cv.COLOR_BGR2HSV);
  const hsvCh = new cv.MatVector(); cv.split(hsv, hsvCh);
  testChannel('HSV饱和度', hsvCh.get(1));
  testChannel('HSV明度', hsvCh.get(2));

  // 颜色差异 max-min
  const bgrCh = new cv.MatVector(); cv.split(bgr, bgrCh);
  const mx = new cv.Mat(); cv.max(bgrCh.get(0), bgrCh.get(1), mx); cv.max(mx, bgrCh.get(2), mx);
  const mn = new cv.Mat(); cv.min(bgrCh.get(0), bgrCh.get(1), mn); cv.min(mn, bgrCh.get(2), mn);
  const diff = new cv.Mat(); cv.subtract(mx, mn, diff);
  testChannel('颜色差异', diff);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
