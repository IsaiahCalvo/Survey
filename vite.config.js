import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// UX 2026-04-22: Bake the current package.json version into the built bundle
// so every Save Log can stamp which app version produced the log.
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
})();

/** Dev-only Vite plugin: serves files from debug/fixtures/ at /debug-fixtures/ */
function debugFixturesPlugin() {
  return {
    name: 'serve-debug-fixtures',
    configureServer(server) {
      server.middlewares.use('/debug-fixtures', (req, res, next) => {
        const filePath = path.join(__dirname, 'debug', 'fixtures', decodeURIComponent(req.url));
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const stat = fs.statSync(filePath);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', stat.size);
        fs.createReadStream(filePath).pipe(res);
      });
    }
  };
}

export default defineConfig({
  base: './', // Use relative paths for Electron file:// protocol
  plugins: [
    react(),
    nodePolyfills({
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
    }),
    debugFixturesPlugin()
  ],
  server: {
    // Port is set via CLI flag from find-port.js
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
  define: {
    'process.env': {},
    global: 'globalThis',
    __APP_VERSION__: JSON.stringify(APP_VERSION)
  }
});
