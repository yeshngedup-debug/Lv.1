import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared')
    }
  },
  publicDir: 'public',
  css: {
    // Prevent Vite from resolving font URLs in @font-face at build time
    // Fonts are in public/fonts/ and served as static assets
    resolve: {
      // Don't process absolute URLs starting with /fonts/
      skipUrlResolver: (url) => url.startsWith('/fonts/')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
