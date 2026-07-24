import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveViteConfigEnv } from './viteEnvConfig.mjs';

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
 * Dev-only Vite plugin: writes the PDF.js feature performance log into the project's
 * Logs/ folder. The demo's "Save log" button (and Cmd+Shift+L) POST the log here
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
            if (!/^PDF\.js feature performance .+\.log$/.test(safe)) {
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

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

function devAuthBootstrapPlugin(env, bootstrapToken) {
  return {
    name: 'dev-auth-bootstrap',
    configureServer(server) {
      server.middlewares.use('/__dev-auth/session', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method_not_allowed' });
          return;
        }
        if (!bootstrapToken || req.headers['x-dev-auth-bootstrap'] !== bootstrapToken) {
          sendJson(res, 403, { error: 'forbidden' });
          return;
        }

        const url = env.VITE_SUPABASE_URL;
        const anonKey = env.VITE_SUPABASE_ANON_KEY;
        const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !anonKey || !serviceRoleKey) {
          sendJson(res, 503, { error: 'dev_auth_not_configured' });
          return;
        }

        try {
          const body = await readJsonBody(req);
          const email = String(body.email || env.VITE_DEV_AUTO_LOGIN_EMAIL || '').trim();
          if (!email) {
            sendJson(res, 400, { error: 'email_required' });
            return;
          }

          const { createClient } = await import('@supabase/supabase-js');
          const admin = createClient(url, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data, error } = await admin.auth.admin.generateLink({
            type: 'magiclink',
            email,
          });
          if (error) {
            sendJson(res, 502, {
              error: 'generate_link_failed',
              code: error.code || null,
              status: error.status || null,
              message: error.message || String(error),
            });
            return;
          }

          const tokenHash = data?.properties?.hashed_token;
          if (!tokenHash) {
            sendJson(res, 502, { error: 'missing_token_hash' });
            return;
          }
          sendJson(res, 200, { token_hash: tokenHash, type: 'magiclink' });
        } catch (err) {
          sendJson(res, 500, {
            error: 'dev_auth_bootstrap_failed',
            message: err?.message || String(err),
          });
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = resolveViteConfigEnv(mode, __dirname);
  const devAuthBootstrapToken = mode === 'development'
    ? randomBytes(24).toString('hex')
    : '';
  // UX: dev-only build stamp shown as a tiny corner chip (AppShell). One
  // stale-tab hunt cost hours because a page loaded from a dead dev server
  // silently kept running old code — the stamp makes "which build am I
  // looking at" answerable at a glance. Git hash + server start time;
  // re-evaluated whenever the dev server (re)starts.
  let buildStamp = '';
  if (mode === 'development') {
    let gitHash = 'no-git';
    try {
      gitHash = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
    } catch { /* not a git checkout — keep placeholder */ }
    const started = new Date().toTimeString().slice(0, 5);
    buildStamp = `${gitHash} · ${started}`;
  }

  return {
    base: './', // Use relative paths for Electron file:// protocol
    plugins: [
      react(),
      debugFixturesPlugin(),
      spikeLogSavePlugin(),
      devAuthBootstrapPlugin(env, devAuthBootstrapToken),
    ],
    server: {
      // Port is set via CLI flag from find-port.js
      // Allow the phone (Expo shell / Capacitor) to load this dev server over
      // Tailscale — the mobile-expo WebView hardcodes the machine's
      // `*.ts.net:5177` address, and Vite otherwise 403s unknown Host headers
      // (anti-DNS-rebinding). Leading-dot = suffix match on any tailnet host.
      // Dev-server only; production ships static files, so this has no prod effect.
      allowedHosts: ['.ts.net'],
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
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      __DEV_AUTH_BOOTSTRAP_TOKEN__: JSON.stringify(devAuthBootstrapToken),
      __BUILD_STAMP__: JSON.stringify(buildStamp),
    }
  };
});
