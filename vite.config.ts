import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the bundle loads from the desktop app's custom protocol as well as http
  base: './',
  clearScreen: false,
  // never watch the Rust build tree: cargo holds locks on target/ DLLs, which crashes the watcher on Windows
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
