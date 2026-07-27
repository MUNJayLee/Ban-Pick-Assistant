import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scraperDir = path.resolve(__dirname, 'scraper');
const rootDir = path.resolve(__dirname, '..');

function run(command, args, cwd) {
  return new Promise((resolve) => {
    console.log(`[pre-run] 正在尝试抓取最新英雄数据：${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });

    child.on('error', (err) => {
      console.warn(`[pre-run] 启动爬取脚本失败：${err.message}`);
      resolve(1);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[pre-run] 爬取数据失败（exit ${code}），将使用已有的 heroes.json 继续启动项目。`);
      } else {
        console.log('[pre-run] 爬取数据成功，项目将使用最新 heroes.json。');
      }
      resolve(code ?? 1);
    });
  });
}

function copyHeroesToPublic() {
  const src = path.join(rootDir, 'src', 'data', 'heroes.json');
  const dest = path.join(rootDir, 'public', 'data', 'heroes.json');
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log('[pre-run] 已同步 heroes.json 到 public/data');
  }
}

// 先确保 scraper 依赖已安装，再执行 fetch
const installCode = await run('npm', ['install'], scraperDir);
if (installCode !== 0) {
  console.warn('[pre-run] 依赖安装失败，将尝试直接运行 fetch。');
}

const fetchCode = await run('npm', ['run', 'fetch'], scraperDir);
if (fetchCode === 0) {
  copyHeroesToPublic();
}
process.exit(0);
