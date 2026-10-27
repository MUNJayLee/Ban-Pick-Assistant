// 对比 sharp 解码 ake.jpg（PNG字节）与 cv2 的像素值（修正偏移）
const sharp = require('sharp');

async function main() {
  const { data, info } = await sharp('avatars/ake.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  console.log('sharp info:', info);
  const ch = info.channels;
  const pts = [[0, 0], [10, 10], [25, 25], [50, 50], [50, 99], [99, 99]];
  for (const [x, y] of pts) {
    const off = (y * info.width + x) * ch;
    const R = data[off], G = data[off + 1], B = data[off + 2];
    const gray = Math.round(0.299 * R + 0.587 * G + 0.114 * B);
    console.log(`(${x},${y}) R=${R} G=${G} B=${B} gray=${gray}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
