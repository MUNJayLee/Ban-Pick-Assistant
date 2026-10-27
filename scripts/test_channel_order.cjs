// 决定性测试：matFromImageData 的通道顺序（RGBA or BGRA）
async function main() {
  const mod = await require('@techstark/opencv-js');
  const cv = mod && mod.Mat ? mod : (await mod);
  await new Promise((r) => { if (cv.Mat) r(); else cv.onRuntimeInitialized = () => r(); });

  // 纯红：R=255 G=0 B=0 A=255
  const red = new Uint8ClampedArray([255, 0, 0, 255]);
  const imgData = { data: red, width: 1, height: 1 };
  const mat = cv.matFromImageData(imgData);
  console.log('channels:', mat.channels());
  console.log('raw data bytes (R,G,B,A order as given):', Array.from(mat.data));

  // 转灰度，看哪个常量给 0.299*255≈76
  const g1 = new cv.Mat(); cv.cvtColor(mat, g1, cv.COLOR_RGBA2GRAY);
  const g2 = new cv.Mat(); cv.cvtColor(mat, g2, cv.COLOR_BGRA2GRAY);
  console.log('RGBA2GRAY value:', g1.data[0]); // 若数据真为RGBA，正确灰度=0.299*255≈76
  console.log('BGRA2GRAY value:', g2.data[0]); // 若数据真为RGBA但按BGRA算，灰度=0.114*255≈29
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
