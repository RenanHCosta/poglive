import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/release/**',
        '**/.artifacts/**',
        '**/.npm-cache/**',
        '**/.electron-cache/**',
      ],
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
