import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  base: './', // Use relative paths for Electron file:// protocol
  plugins: [
    react(),
    nodePolyfills({
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
    })
  ],
  server: {
    port: 5173,
    headers: {
      // Allow MSAL popup authentication to work properly
      // Using 'same-origin-allow-popups' allows the popup to communicate back to the parent
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      // Allow embedding and cross-origin requests for MSAL iframes
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    }
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