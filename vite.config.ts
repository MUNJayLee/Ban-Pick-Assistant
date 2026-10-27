import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { fetchDataPlugin } from './src/vite-plugins/fetchDataPlugin';

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: 'hidden',
  },
  server: {
    watch: {
      // 后端/数据目录无需前端 HMR 监听，避免大文件（如 ONNX 模型）触发 EBUSY 崩溃
      ignored: [
        '**/models/**',
        '**/scripts/**',
        '**/avatars/**',
        '**/recognition/**',
        '**/测试用例/**',
        '**/*.onnx',
        '**/*.tmpdir/**',
        '**/*.tmp',
      ],
    },
  },
  plugins: [
    react(),
    tsconfigPaths(),
    fetchDataPlugin(),
  ],
})
