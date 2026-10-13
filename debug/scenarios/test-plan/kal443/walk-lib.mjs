// KAL-443 walk helpers: FakeBackend for rows + an in-memory storage bucket.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { FakeBackend } from '../tp-fake-backend.mjs';
import { prepareLocalContext, viewerUrl } from '../tp-local-doc.mjs';

export const OUT = new URL('../../../../artifacts/KAL-443/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
export const USER = 'dev-test-user';
export const PA = '7e57d0c0-0000-4000-8000-0000000a0443';
export const PB = '7e57d0c0-0000-4000-8000-0000000b0443';
export const DOC = '7e57d0c0-0000-4000-8000-000000000443';
export const PDF_NAME = 'clickable-link-test.pdf';
export const PDF = readFileSync(new URL(`../../../fixtures/${PDF_NAME}`, import.meta.url));
export const sha = (b) => createHash('sha256').update(b).digest('hex');
export const PDF_SHA = sha(PDF);

export function seed(backend) {
  const now = '2026-10-01T00:00:00.000Z';
  backend.table('projects').push(
    { id: PA, user_id: USER, name: 'Tower A', created_at: now, updated_at: now, user_archived_at: null },
    { id: PB, user_id: USER, name: 'Tower B', created_at: now, updated_at: now, user_archived_at: null },
  );
  Object.assign(backend.table('documents')[0], {
    name: 'Riser.pdf', project_id: PA, file_path: `${USER}/${PDF_SHA}.pdf`, content_sha256: PDF_SHA,
    file_size: PDF.length, page_count: 1, archived: false, user_archived_at: null, updated_at: now,
  });
}

export async function attachStorage(ctx, objects, log) {
  const cors = (req) => ({
    'access-control-allow-origin': req.headers().origin || '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': '*, authorization, apikey, content-type, x-upsert, cache-control, x-client-info',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, HEAD, OPTIONS',
  });
  await ctx.route(/\.supabase\.co\/storage\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(req), body: '' });
    const m = url.pathname.match(/^\/storage\/v1\/object\/(info\/|public\/|authenticated\/)?documents\/(.+)$/);
    const path = m ? decodeURIComponent(m[2]) : null;
    log.push(`${method} ${url.pathname}`);
    if (method === 'GET' && m?.[1] === 'info/') {
      const b = objects.get(path);
      if (!b) { log.push(`404 ${method} ${url.pathname}`); } if (!b) return route.fulfill({ status: 404, headers: cors(req), contentType: 'application/json', body: '{"message":"Object not found"}' });
      return route.fulfill({ status: 200, headers: cors(req), contentType: 'application/json', body: JSON.stringify({ id: path, name: path, size: b.length, etag: sha(b), version: sha(b), content_type: 'application/pdf', last_modified: '2026-10-01T00:00:00Z' }) });
    }
    if (method === 'GET' && path) {
      const b = objects.get(path);
      if (!b) { log.push(`404 ${method} ${url.pathname}`); } if (!b) return route.fulfill({ status: 404, headers: cors(req), contentType: 'application/json', body: '{"message":"Object not found"}' });
      return route.fulfill({ status: 200, headers: cors(req), contentType: 'application/pdf', body: b });
    }
    if ((method === 'POST' || method === 'PUT') && path) {
      let body = req.postDataBuffer() || Buffer.alloc(0);
      // storage-js sends a Blob as multipart/form-data: keep only the file part.
      const ct = req.headers()['content-type'] || '';
      const bm = ct.match(/boundary=(.+)$/);
      if (bm) {
        const boundary = Buffer.from(`--${bm[1]}`);
        let from = 0; const parts = [];
        for (;;) { const i = body.indexOf(boundary, from); if (i < 0) break; parts.push(i); from = i + boundary.length; }
        for (let k = 0; k + 1 < parts.length; k += 1) {
          const chunk = body.subarray(parts[k] + boundary.length, parts[k + 1]);
          const h = chunk.indexOf('\r\n\r\n');
          if (h >= 0 && /filename=|application\/pdf/.test(chunk.subarray(0, h).toString())) {
            body = Buffer.from(chunk.subarray(h + 4, chunk.length - 2));
          }
        }
      }
      log.push(`stored ${path.slice(-12)} ${body.length} bytes`);
      objects.set(path, body);
      return route.fulfill({ status: 200, headers: cors(req), contentType: 'application/json', body: JSON.stringify({ Key: `documents/${path}`, Id: path }) });
    }
    if (method === 'DELETE' || (method === 'POST' && /\/object\/documents$/.test(url.pathname))) {
      return route.fulfill({ status: 200, headers: cors(req), contentType: 'application/json', body: '[]' });
    }
    return route.fulfill({ status: 200, headers: cors(req), contentType: 'application/json', body: '{}' });
  });
}

export async function open({ viewport = { width: 1440, height: 900 }, phone = false } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const backend = new FakeBackend({ documentId: DOC });
  seed(backend);
  const objects = new Map([[`${USER}/${PDF_SHA}.pdf`, PDF]]);
  const storageLog = [];
  const ctx = await browser.newContext({ viewport, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await prepareLocalContext(ctx, DOC, { backend });
  await attachStorage(ctx, objects, storageLog);
  await ctx.addInitScript(() => { window.__toasts = []; window.addEventListener('app-toast', (e) => window.__toasts.push(`${e.detail.type}: ${e.detail.message}`)); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  await page.goto(viewerUrl(PDF_NAME, { cloudLibrary: true, phone }));
  await page.waitForTimeout(8000);
  return { browser, backend, objects, storageLog, page, errors };
}

export const visibleControls = (page) => page.evaluate(() => [...document.querySelectorAll('button,[role=tab],[role=menuitem],a,[role=option]')]
  .filter((e) => e.getBoundingClientRect().width > 0)
  .map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)).filter(Boolean));
export const docRows = (backend) => backend.table('documents').map((r) => ({ id: r.id.slice(-6), name: r.name, project: r.project_id === PA ? 'A' : r.project_id === PB ? 'B' : r.project_id, sha: r.content_sha256 ? r.content_sha256.slice(0, 12) : r.content_sha256, path: r.file_path }));
