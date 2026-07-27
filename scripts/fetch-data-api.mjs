import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scraperDir = path.resolve(__dirname, 'scraper');
const heroesPath = path.resolve(__dirname, '../src/data/heroes.json');

export async function runFetchData() {
  // 安装依赖
  await new Promise((resolve) => {
    const child = spawn('npm', ['install'], {
      cwd: scraperDir,
      stdio: 'inherit',
      shell: true,
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });

  // 运行 fetch
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'fetch'], {
      cwd: scraperDir,
      stdio: 'inherit',
      shell: true,
    });
    child.on('error', reject);
    child.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`爬取失败，exit ${code}`));
        return;
      }
      try {
        const raw = await fs.readFile(heroesPath, 'utf-8');
        const data = JSON.parse(raw);
        resolve(data);
      } catch (err) {
        reject(err);
      }
    });
  });
}
