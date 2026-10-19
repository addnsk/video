import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const crossOriginIsolation = (): Plugin => ({
  name: 'cross-origin-isolation',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'coi-serviceworker.js',
      source: readFileSync(new URL('./node_modules/coi-serviceworker/coi-serviceworker.min.js', import.meta.url)),
    });
  },
  transformIndexHtml: () => [{ tag: 'script', attrs: { src: './coi-serviceworker.js' }, injectTo: 'head-prepend' }],
});

export default defineConfig({
  base: './',
  plugins: [react(), crossOriginIsolation()],
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: ISOLATION_HEADERS },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
  worker: { format: 'es' },
});
