import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const child = spawn('node', ['node_modules/vite/bin/vite.js'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: false,
});

child.on('error', (err) => {
  console.error('[dev] 启动 Vite 失败：', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});
