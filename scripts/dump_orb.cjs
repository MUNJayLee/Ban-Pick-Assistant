// 输出 ake.jpg 经 circular(48) 后的 ORB 关键点数和描述子摘要（WASM）
const sharp = require('sharp');

async function main() {
  const mod = await require('@techstark/opencv-js');
  const cv = mod && mod.Mat ? mod : (await mod);
  await new Promise((r) => { if (cv.Mat) r(); else cv.onRuntimeInitialized = () => r(); });

  const { data, info } = await sharp('avatars/ake.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageData = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  const mat = cv.matFromImageData(imageData);
  const bgr = new cv.Mat(); cv.cvtColor(mat, bgr, cv.COLOR_RGBA2BGR);

  const resized = new cv.Mat(); cv.resize(bgr, resized, new cv.Size(48, 48));
  const mask = cv.Mat.zeros(48, 48, cv.CV_8UC1);
  cv.circle(mask, new cv.Point(24, 24), 24, new cv.Scalar(255), -1);
  const masked = new cv.Mat(); cv.bitwise_and(resized, resized, masked, mask);
  const cir = new cv.Mat(); cv.resize(masked, cir, new cv.Size(256, 256));

  const orb = new cv.ORB(1000);
  const kp = new cv.KeyPointVector(); const des = new cv.Mat();
  orb.detectAndCompute(cir, new cv.Mat(), kp, des);
  console.log('keypoints:', kp.size());
  console.log('descriptor shape:', des.rows, 'x', des.cols);
  if (des.rows > 0) {
    const first = [];
    for (let i = 0; i < 16; i++) first.push(des.data[i]);
    console.log('first desc (16 bytes):', first.join(' '));
    let sum = 0; for (let i = 0; i < des.rows * des.cols; i++) sum += des.data[i];
    console.log('desc sum:', sum);
  }
  const gray = new cv.Mat(); cv.cvtColor(cir, gray, cv.COLOR_BGR2GRAY);
  console.log('gray[0,0]=', gray.data[0], 'gray[128,128]=', gray.data[128 * 256 + 128], 'gray[100,50]=', gray.data[100 * 256 + 50]);
  let gsum = 0; for (let i = 0; i < 256 * 256; i++) gsum += gray.data[i];
  console.log('gray sum:', gsum);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
