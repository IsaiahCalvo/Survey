import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@syncfusion/ej2-interactive-chat': path.resolve(__dirname, 'src/shims/ej2-interactive-chat.js'),
      '@syncfusion/ej2-markdown-converter': path.resolve(__dirname, 'src/shims/ej2-markdown-converter.js')
    }
  },
  optimizeDeps: {
    include: ['xlsx-js-style']
  },
  define: {
    'process.env': {},
    global: 'globalThis'
  }
});
