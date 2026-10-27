// 抓取王者荣耀接口文章，提取头像相关 URL
const urls = [
  'https://m.duotegame.com/mgl/69098.html',
  'https://github.com/jieshenboy/HeadTogetherOfKOG',
];

async function main() {
  for (const u of urls) {
    console.log('\n=== ' + u + ' ===');
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await r.text();
      const re = /https?:\/\/[^"'\\\s<>)]*(?:gtimg|pvp\.qq|mcxssg)[^"'\\\s<>)]*/g;
      const found = [...new Set(html.match(re) || [])];
      found.forEach((x) => console.log(' ', x));
      if (found.length === 0) console.log('  (无匹配 URL)');
    } catch (e) {
      console.log('  ERR:', e.message);
    }
  }
}

main();
