// 验证 @techstark/opencv-js 的通道行为与颜色转换
const sharp = require('sharp');

async function main() {
  const mod = await require('@techstark/opencv-js');
  const cv = mod && mod.Mat ? mod : (await mod);
  await new Promise((r) => { if (cv.Mat) r(); else cv.onRuntimeInitialized = () => r(); });

  console.log('constants:', {
    COLOR_BGR2GRAY: cv.COLOR_BGR2GRAY,
    COLOR_RGBA2GRAY: cv.COLOR_RGBA2GRAY,
    COLOR_RGBA2BGR: cv.COLOR_RGBA2BGR,
    COLOR_BGR2GRAY: cv.COLOR_BGR2GRAY,
  });

  const av = 'avatars/ake.jpg'; // 阿轲(示例)
  const { data, info } = await sharp(av).removeAlpha().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  console.log('sharp info:', info);

  // 模拟 cv.imread 返回的 RGBA ImageData
  const imageData = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  const mat = cv.matFromImageData(imageData);
  console.log('mat channels:', mat.channels(), 'type:', mat.type(), 'size:', mat.cols, 'x', mat.rows);

  const grayBgr = new cv.Mat();
  try {
    cv.cvtColor(mat, grayBgr, cv.COLOR_BGR2GRAY);
    console.log('BGR2GRAY ok, channels:', grayBgr.channels());
  } catch (e) {
    console.log('BGR2GRAY THROWS:', e && e.message);
  }

  const grayRgba = new cv.Mat();
  try {
    cv.cvtColor(mat, grayRgba, cv.COLOR_RGBA2GRAY);
    console.log('RGBA2GRAY ok, channels:', grayRgba.channels());
  } catch (e) {
    console.log('RGBA2GRAY THROWS:', e && e.message);
  }

  if (!grayBgr.empty() && !grayRgba.empty()) {
    let diff = 0, maxd = 0;
    for (let i = 0; i < grayBgr.rows * grayBgr.cols; i++) {
      const d = Math.abs(grayBgr.data[i] - grayRgba.data[i]);
      diff += d; maxd = Math.max(maxd, d);
    }
    console.log('gray diff (avg):', (diff / (grayBgr.rows * grayBgr.cols)).toFixed(3), 'max:', maxd);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
