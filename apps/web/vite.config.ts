import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5178, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:4031', changeOrigin: true } } },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
