import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function run(name, args) {
  return new Promise((resolve, reject) => {
    console.log(`[build] ${name}`);
    const child = spawn('node', args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${name} 失败（exit ${code}）`));
      } else {
        resolve();
      }
    });
  });
}

function copyHeroesToPublic() {
  const src = path.join(rootDir, 'src', 'data', 'heroes.json');
  const dest = path.join(rootDir, 'public', 'data', 'heroes.json');
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log('[build] 已同步 heroes.json 到 public/data');
  }
}

function copyScraperToResources() {
  const src = path.join(rootDir, 'scripts', 'scraper');
  const dest = path.join(rootDir, 'src-tauri', 'resources', 'scraper');
  if (!fs.existsSync(src)) return;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const srcPath = path.join(from, entry.name);
      const destPath = path.join(to, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDir(src, dest);

  const nm = path.join(dest, 'node_modules');
  const nmSize = fs.existsSync(nm)
    ? (fs.readdirSync(nm).length + ' 个包')
    : '无';
  console.log('[build] 已同步 scraper 到 src-tauri/resources/scraper（含 ' + nmSize + '）');
}

copyHeroesToPublic();
copyScraperToResources();
await run('TypeScript 类型检查', ['node_modules/typescript/bin/tsc', '-b']);
await run('Vite 生产构建', ['node_modules/vite/bin/vite.js', 'build']);
console.log('[build] 构建完成');
