import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
    })
  ],
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist'
  },
  optimizeDeps: {
    include: ['xlsx-js-style']
  },
  define: {
    'process.env': {},
    global: 'globalThis'
  }
});