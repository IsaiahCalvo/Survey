import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
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

/**
 * Dev-only Vite plugin: writes a renderer-spike comparison log into the project's
 * Logs/ folder. The spike's "Save log" button (and Cmd+Shift+L) POST the log here
 * because a browser download can only reach the OS Downloads folder, not a project
 * path. Filename is validated to the spike's own scheme — no path traversal.
 */
function spikeLogSavePlugin() {
  return {
    name: 'save-spike-log',
    configureServer(server) {
      server.middlewares.use('/__save-spike-log', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const { filename, text } = JSON.parse(body || '{}');
            const safe = String(filename || '').replace(/[/\\]/g, '');
            if (!/^PDF render comparison .+\.log$/.test(safe)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'bad filename' }));
              return;
            }
            const dir = path.join(__dirname, 'Logs');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, safe), String(text ?? ''), 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: `Logs/${safe}` }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: String((e && e.message) || e) }));
          }
        });
      });
    }
  };
}

/** Dev-only Vite plugin: serves files from debug/fixtures/ at /debug-fixtures/ */
function debugFixturesPlugin() {
  return {
    name: 'serve-debug-fixtures',
    configureServer(server) {
      server.middlewares.use('/debug-fixtures', (req, res, next) => {
        const fixturesRoot = path.resolve(__dirname, 'debug', 'fixtures');
        const filePath = path.resolve(fixturesRoot, '.' + decodeURIComponent(req.url));
        if (filePath !== fixturesRoot && !filePath.startsWith(fixturesRoot + path.sep)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
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
    debugFixturesPlugin(),
    spikeLogSavePlugin()
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
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Split heavy, self-contained third-party libraries into their own
        // cached chunks. These are leaf libraries (no app imports), so isolating
        // them is safe and (a) shrinks the big viewer chunk by extracting shared
        // vendors and (b) lets a phone keep them cached across app-code updates
        // instead of re-downloading multiple MB every release. App code and
        // everything else keep Vite's default chunking.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/pdfjs-dist/')) return 'vendor-pdfjs';
          if (id.includes('/pdf-lib/')) return 'vendor-pdflib';
          if (id.includes('/fabric/')) return 'vendor-fabric';
          if (id.includes('/exceljs/')) return 'vendor-exceljs';
          if (id.includes('/yjs/') || id.includes('/y-protocols/') || id.includes('/y-indexeddb/') || id.includes('/lib0/')) return 'vendor-yjs';
          if (id.includes('/@supabase/')) return 'vendor-supabase';
          return undefined;
        }
      }
    }
  },
  resolve: {
    preserveSymlinks: true
  },
  define: {
    'process.env': {},
    global: 'globalThis',
    __APP_VERSION__: JSON.stringify(APP_VERSION)
  }
});
